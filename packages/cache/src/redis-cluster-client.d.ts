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
import { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';
export interface RedisClusterConfig {
    nodes: ClusterNode[];
    clusterOptions?: Partial<ClusterOptions>;
    redisOptions?: Partial<RedisOptions>;
    maxRetries?: number;
    retryDelay?: number;
    healthCheckInterval?: number;
    healthCheckTimeout?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerTimeout?: number;
}
export interface ClusterNodeStats {
    host: string;
    port: number;
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    role: 'master' | 'slave' | 'unknown';
    slots?: string[];
    uptime?: number;
    connectedClients?: number;
    usedMemory?: number;
    usedMemoryHuman?: string;
    totalKeys?: number;
}
export interface ClusterStats {
    totalNodes: number;
    connectedNodes: number;
    masterNodes: number;
    slaveNodes: number;
    totalSlots: number;
    nodes: ClusterNodeStats[];
    health: 'healthy' | 'degraded' | 'unhealthy';
}
export interface ClusterMetrics {
    commands: {
        total: number;
        successful: number;
        failed: number;
        retried: number;
    };
    latency: {
        p50: number;
        p95: number;
        p99: number;
        avg: number;
    };
    connections: {
        active: number;
        idle: number;
        errors: number;
    };
}
export declare class RedisClusterClient {
    private cluster;
    private readonly config;
    private healthCheckTimer?;
    private failureCount;
    private circuitOpen;
    private circuitOpenedAt?;
    private metrics;
    private latencySamples;
    private readonly maxLatencySamples;
    constructor(config: RedisClusterConfig);
    private createCluster;
    private setupEventHandlers;
    private startHealthCheck;
    private performHealthCheck;
    private updateClusterInfo;
    private updateConnectionMetrics;
    private recordLatency;
    private recordFailure;
    private openCircuitBreaker;
    private resetCircuitBreaker;
    private checkCircuitBreaker;
    /**
     * Execute a Redis command with automatic retries and circuit breaking
     */
    executeCommand<T>(command: string, ...args: unknown[]): Promise<T>;
    /**
     * Get comprehensive cluster statistics
     */
    getStats(): Promise<ClusterStats>;
    private parseInfoValue;
    /**
     * Get performance metrics
     */
    getMetrics(): ClusterMetrics;
    /**
     * Check if circuit breaker is open
     */
    isCircuitBreakerOpen(): boolean;
    /**
     * Manually reset circuit breaker
     */
    manualResetCircuitBreaker(): void;
    /**
     * Get the underlying cluster instance
     * Use with caution - direct access bypasses circuit breaker
     */
    getCluster(): Cluster;
    /**
     * Graceful shutdown
     */
    disconnect(): Promise<void>;
}
/**
 * Factory function to create a Redis Cluster client with sensible defaults
 */
export declare function createRedisCluster(nodes: ClusterNode[], options?: Partial<RedisClusterConfig>): RedisClusterClient;
/**
 * Utility function to create cluster nodes from environment variable
 * Expected format: "host1:port1,host2:port2,host3:port3"
 */
export declare function parseClusterNodes(nodesString: string): ClusterNode[];
//# sourceMappingURL=redis-cluster-client.d.ts.map