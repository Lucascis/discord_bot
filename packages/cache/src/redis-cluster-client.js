/**
 * Redis Cluster Client
 * Purpose: High-availability Redis client with cluster support and automatic failover
 * Author: Discord Bot Team
 * Last Updated: 2025-11-03
 *
 * Features:
 * - Redis Cluster support for horizontal scaling
 * - Automatic node discovery and failover
 * - Connection pooling per cluster node
 * - Health monitoring and circuit breaking
 * - Comprehensive metrics and observability
 * - Graceful degradation on partial failures
 */
import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
export class RedisClusterClient {
    constructor(config) {
        // Circuit breaker state
        this.failureCount = 0;
        this.circuitOpen = false;
        // Metrics
        this.metrics = {
            commands: {
                total: 0,
                successful: 0,
                failed: 0,
                retried: 0
            },
            latency: {
                p50: 0,
                p95: 0,
                p99: 0,
                avg: 0
            },
            connections: {
                active: 0,
                idle: 0,
                errors: 0
            }
        };
        this.latencySamples = [];
        this.maxLatencySamples = 1000;
        this.config = {
            nodes: config.nodes,
            clusterOptions: config.clusterOptions || {},
            redisOptions: config.redisOptions || {},
            maxRetries: config.maxRetries ?? 3,
            retryDelay: config.retryDelay ?? 1000,
            healthCheckInterval: config.healthCheckInterval ?? 30000,
            healthCheckTimeout: config.healthCheckTimeout ?? 5000,
            circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
            circuitBreakerTimeout: config.circuitBreakerTimeout ?? 60000
        };
        this.cluster = this.createCluster();
        this.setupEventHandlers();
        this.startHealthCheck();
        logger.info({
            nodes: this.config.nodes.length,
            maxRetries: this.config.maxRetries,
            healthCheckInterval: this.config.healthCheckInterval
        }, 'Redis Cluster client initialized');
    }
    createCluster() {
        const cluster = new Redis.Cluster(this.config.nodes, {
            // Cluster-specific options
            clusterRetryStrategy: (times) => {
                if (times > this.config.maxRetries) {
                    logger.error({ times }, 'Max cluster retry attempts exceeded');
                    return null;
                }
                const delay = Math.min(times * this.config.retryDelay, 10000);
                logger.warn({ times, delay }, 'Retrying cluster connection');
                return delay;
            },
            enableReadyCheck: true,
            enableOfflineQueue: true,
            redisOptions: {
                enableReadyCheck: true,
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    if (times > this.config.maxRetries) {
                        return null;
                    }
                    return Math.min(times * this.config.retryDelay, 5000);
                },
                ...this.config.redisOptions
            },
            // Scale reads to slaves
            scaleReads: 'slave',
            ...this.config.clusterOptions
        });
        return cluster;
    }
    setupEventHandlers() {
        this.cluster.on('ready', () => {
            logger.info('Redis Cluster is ready');
            this.resetCircuitBreaker();
            this.updateConnectionMetrics();
        });
        this.cluster.on('error', (error) => {
            logger.error({ error: error.message }, 'Redis Cluster error');
            this.recordFailure();
            this.metrics.connections.errors++;
        });
        this.cluster.on('close', () => {
            logger.warn('Redis Cluster connection closed');
        });
        this.cluster.on('reconnecting', () => {
            logger.info('Redis Cluster reconnecting');
        });
        this.cluster.on('+node', (node) => {
            logger.info({
                host: node.options.host,
                port: node.options.port
            }, 'New node added to cluster');
            this.updateConnectionMetrics();
        });
        this.cluster.on('-node', (node) => {
            logger.warn({
                host: node.options.host,
                port: node.options.port
            }, 'Node removed from cluster');
            this.updateConnectionMetrics();
        });
        this.cluster.on('node error', (error, address) => {
            logger.error({
                error: error.message,
                address
            }, 'Cluster node error');
        });
    }
    startHealthCheck() {
        this.healthCheckTimer = setInterval(async () => {
            try {
                await this.performHealthCheck();
            }
            catch (error) {
                logger.error({
                    error: error instanceof Error ? error.message : String(error)
                }, 'Health check failed');
            }
        }, this.config.healthCheckInterval);
    }
    async performHealthCheck() {
        const startTime = Date.now();
        try {
            // Ping cluster to verify connectivity
            await Promise.race([
                this.cluster.ping(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeout))
            ]);
            const responseTime = Date.now() - startTime;
            this.recordLatency(responseTime);
            // Update cluster info
            await this.updateClusterInfo();
            logger.debug({ responseTime }, 'Cluster health check passed');
        }
        catch (error) {
            logger.error({
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            }, 'Cluster health check failed');
            this.recordFailure();
        }
    }
    async updateClusterInfo() {
        try {
            const nodes = this.cluster.nodes('all');
            this.metrics.connections.active = nodes.length;
            // Get cluster info from master node
            const info = await this.cluster.cluster('INFO');
            if (typeof info === 'string') {
                const clusterState = info.match(/cluster_state:(ok|fail)/)?.[1];
                if (clusterState !== 'ok') {
                    logger.warn({ clusterState }, 'Cluster state is not OK');
                }
            }
        }
        catch (error) {
            logger.error({
                error: error instanceof Error ? error.message : String(error)
            }, 'Failed to update cluster info');
        }
    }
    updateConnectionMetrics() {
        const nodes = this.cluster.nodes('all');
        this.metrics.connections.active = nodes.length;
    }
    recordLatency(latency) {
        this.latencySamples.push(latency);
        // Keep only recent samples
        if (this.latencySamples.length > this.maxLatencySamples) {
            this.latencySamples.shift();
        }
        // Update percentiles
        if (this.latencySamples.length > 0) {
            const sorted = [...this.latencySamples].sort((a, b) => a - b);
            const p50Index = Math.floor(sorted.length * 0.5);
            const p95Index = Math.floor(sorted.length * 0.95);
            const p99Index = Math.floor(sorted.length * 0.99);
            this.metrics.latency.p50 = sorted[p50Index];
            this.metrics.latency.p95 = sorted[p95Index];
            this.metrics.latency.p99 = sorted[p99Index];
            this.metrics.latency.avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        }
    }
    recordFailure() {
        this.failureCount++;
        this.metrics.commands.failed++;
        if (this.failureCount >= this.config.circuitBreakerThreshold) {
            this.openCircuitBreaker();
        }
    }
    openCircuitBreaker() {
        if (!this.circuitOpen) {
            this.circuitOpen = true;
            this.circuitOpenedAt = Date.now();
            logger.error({
                failureCount: this.failureCount,
                threshold: this.config.circuitBreakerThreshold
            }, 'Circuit breaker opened - too many failures');
            // Auto-reset circuit breaker after timeout
            setTimeout(() => {
                this.resetCircuitBreaker();
            }, this.config.circuitBreakerTimeout);
        }
    }
    resetCircuitBreaker() {
        if (this.circuitOpen) {
            logger.info('Circuit breaker reset');
        }
        this.circuitOpen = false;
        this.circuitOpenedAt = undefined;
        this.failureCount = 0;
    }
    checkCircuitBreaker() {
        if (this.circuitOpen) {
            const elapsed = Date.now() - (this.circuitOpenedAt || 0);
            throw new Error(`Circuit breaker is open. Retry after ${Math.ceil((this.config.circuitBreakerTimeout - elapsed) / 1000)}s`);
        }
    }
    /**
     * Execute a Redis command with automatic retries and circuit breaking
     */
    async executeCommand(command, ...args) {
        this.checkCircuitBreaker();
        const startTime = Date.now();
        this.metrics.commands.total++;
        let lastError;
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                // @ts-expect-error - Dynamic command execution
                const result = await this.cluster[command](...args);
                const latency = Date.now() - startTime;
                this.recordLatency(latency);
                this.metrics.commands.successful++;
                if (attempt > 1) {
                    this.metrics.commands.retried++;
                }
                // Reset failure count on success
                if (this.failureCount > 0) {
                    this.failureCount = Math.max(0, this.failureCount - 1);
                }
                return result;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn({
                    command,
                    attempt,
                    maxRetries: this.config.maxRetries,
                    error: lastError.message
                }, 'Redis command failed, retrying');
                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
                }
            }
        }
        // All retries exhausted
        this.recordFailure();
        logger.error({
            command,
            attempts: this.config.maxRetries,
            error: lastError?.message
        }, 'Redis command failed after all retries');
        throw lastError || new Error('Command failed');
    }
    /**
     * Get comprehensive cluster statistics
     */
    async getStats() {
        const nodes = this.cluster.nodes('all');
        const nodeStats = [];
        let connectedNodes = 0;
        let masterNodes = 0;
        let slaveNodes = 0;
        for (const node of nodes) {
            try {
                const info = await node.info();
                const role = info.includes('role:master') ? 'master' :
                    info.includes('role:slave') ? 'slave' : 'unknown';
                if (role === 'master')
                    masterNodes++;
                if (role === 'slave')
                    slaveNodes++;
                const status = node.status === 'ready' ? 'connected' :
                    node.status === 'connecting' ? 'connecting' :
                        'disconnected';
                if (status === 'connected')
                    connectedNodes++;
                // Parse memory usage
                const usedMemoryMatch = info.match(/used_memory:(\d+)/);
                const usedMemoryHumanMatch = info.match(/used_memory_human:([^\r\n]+)/);
                nodeStats.push({
                    host: node.options.host || 'unknown',
                    port: node.options.port || 0,
                    status,
                    role,
                    uptime: this.parseInfoValue(info, 'uptime_in_seconds'),
                    connectedClients: this.parseInfoValue(info, 'connected_clients'),
                    usedMemory: usedMemoryMatch ? parseInt(usedMemoryMatch[1]) : undefined,
                    usedMemoryHuman: usedMemoryHumanMatch?.[1]?.trim()
                });
            }
            catch (error) {
                nodeStats.push({
                    host: node.options.host || 'unknown',
                    port: node.options.port || 0,
                    status: 'error',
                    role: 'unknown'
                });
            }
        }
        // Determine overall health
        let health = 'healthy';
        const healthRatio = connectedNodes / nodes.length;
        if (healthRatio < 0.5) {
            health = 'unhealthy';
        }
        else if (healthRatio < 1.0) {
            health = 'degraded';
        }
        return {
            totalNodes: nodes.length,
            connectedNodes,
            masterNodes,
            slaveNodes,
            totalSlots: 16384, // Redis Cluster has 16384 slots
            nodes: nodeStats,
            health
        };
    }
    parseInfoValue(info, key) {
        const match = info.match(new RegExp(`${key}:(\\d+)`));
        return match ? parseInt(match[1]) : undefined;
    }
    /**
     * Get performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            latency: { ...this.metrics.latency }
        };
    }
    /**
     * Check if circuit breaker is open
     */
    isCircuitBreakerOpen() {
        return this.circuitOpen;
    }
    /**
     * Manually reset circuit breaker
     */
    manualResetCircuitBreaker() {
        this.resetCircuitBreaker();
        logger.info('Circuit breaker manually reset');
    }
    /**
     * Get the underlying cluster instance
     * Use with caution - direct access bypasses circuit breaker
     */
    getCluster() {
        return this.cluster;
    }
    /**
     * Graceful shutdown
     */
    async disconnect() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        try {
            await this.cluster.quit();
            logger.info('Redis Cluster disconnected gracefully');
        }
        catch (error) {
            logger.error({
                error: error instanceof Error ? error.message : String(error)
            }, 'Error during cluster disconnect');
            // Force disconnect if graceful quit fails
            this.cluster.disconnect();
        }
    }
}
/**
 * Factory function to create a Redis Cluster client with sensible defaults
 */
export function createRedisCluster(nodes, options) {
    return new RedisClusterClient({
        nodes,
        ...options
    });
}
/**
 * Utility function to create cluster nodes from environment variable
 * Expected format: "host1:port1,host2:port2,host3:port3"
 */
export function parseClusterNodes(nodesString) {
    return nodesString.split(',').map(nodeStr => {
        const [host, portStr] = nodeStr.trim().split(':');
        const port = parseInt(portStr || '6379', 10);
        if (!host || isNaN(port)) {
            throw new Error(`Invalid cluster node format: ${nodeStr}`);
        }
        return { host, port };
    });
}
