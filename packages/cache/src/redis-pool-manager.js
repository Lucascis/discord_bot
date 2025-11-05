import Redis from 'ioredis';
import { logger, PerformanceMonitor } from '@discord-bot/logger';
export class RedisPoolManager {
    constructor() {
        this.pools = new Map();
    }
    static getInstance() {
        if (!RedisPoolManager.instance) {
            RedisPoolManager.instance = new RedisPoolManager();
        }
        return RedisPoolManager.instance;
    }
    createPool(name, config) {
        if (this.pools.has(name)) {
            logger.warn(`Redis pool '${name}' already exists, returning existing pool`);
            return this.pools.get(name);
        }
        const pool = new RedisConnectionPool(name, config);
        this.pools.set(name, pool);
        logger.info(`Created Redis connection pool '${name}'`, {
            minConnections: config.minConnections,
            maxConnections: config.maxConnections
        });
        return pool;
    }
    getPool(name) {
        return this.pools.get(name);
    }
    async closeAllPools() {
        const closePromises = Array.from(this.pools.values()).map(pool => pool.close());
        await Promise.all(closePromises);
        this.pools.clear();
        logger.info('All Redis connection pools closed');
    }
    getPoolStats() {
        const stats = {};
        for (const [name, pool] of this.pools) {
            stats[name] = pool.getStats();
        }
        return stats;
    }
}
export class RedisConnectionPool {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.connections = [];
        this.waitingQueue = [];
        this.healthCheckInterval = null;
        this.connectionIdCounter = 0;
        this.closed = false;
        this.initialize();
        this.startHealthCheck();
        this.setupConnectionPoolMonitoring();
    }
    async initialize() {
        // Create minimum connections
        for (let i = 0; i < this.config.minConnections; i++) {
            try {
                await this.createConnection();
            }
            catch (error) {
                logger.error(`Failed to create initial connection ${i} for pool '${this.name}'`, error);
            }
        }
        logger.info(`Redis pool '${this.name}' initialized with ${this.connections.length} connections`);
    }
    async createConnection() {
        const connectionId = `${this.name}-${++this.connectionIdCounter}`;
        const redis = new Redis({
            ...this.config.redisOptions,
            enableReadyCheck: true,
            lazyConnect: true,
            maxRetriesPerRequest: 3,
            // Connection pool specific settings
            keepAlive: 30000,
            connectTimeout: 10000,
            commandTimeout: 5000
        });
        const connection = {
            id: connectionId,
            redis,
            acquired: false,
            lastUsed: new Date(),
            createdAt: new Date()
        };
        // Connection event handlers
        redis.on('error', (error) => {
            logger.error(`Redis connection error in pool '${this.name}', connection '${connectionId}'`, error);
            this.removeConnection(connection);
        });
        redis.on('close', () => {
            logger.warn(`Redis connection closed in pool '${this.name}', connection '${connectionId}'`);
            this.removeConnection(connection);
        });
        redis.on('reconnecting', () => {
            logger.info(`Redis connection reconnecting in pool '${this.name}', connection '${connectionId}'`);
        });
        try {
            await redis.connect();
            this.connections.push(connection);
            logger.debug(`Created Redis connection '${connectionId}' for pool '${this.name}'`);
            return connection;
        }
        catch (error) {
            logger.error(`Failed to connect Redis connection '${connectionId}' for pool '${this.name}'`, error);
            throw error;
        }
    }
    async acquire() {
        if (this.closed) {
            throw new Error(`Pool '${this.name}' is closed`);
        }
        // Try to find an available connection
        const availableConnection = this.connections.find(conn => !conn.acquired);
        if (availableConnection) {
            availableConnection.acquired = true;
            availableConnection.lastUsed = new Date();
            logger.debug(`Acquired connection '${availableConnection.id}' from pool '${this.name}'`);
            return availableConnection;
        }
        // Create new connection if under max limit
        if (this.connections.length < this.config.maxConnections) {
            try {
                const newConnection = await this.createConnection();
                newConnection.acquired = true;
                newConnection.lastUsed = new Date();
                logger.debug(`Created and acquired new connection '${newConnection.id}' for pool '${this.name}'`);
                return newConnection;
            }
            catch (error) {
                logger.error(`Failed to create new connection for pool '${this.name}'`, error);
                // Fall through to waiting queue
            }
        }
        // Wait in queue for available connection
        return new Promise((resolve, reject) => {
            const request = {
                resolve,
                reject,
                timestamp: Date.now()
            };
            this.waitingQueue.push(request);
            // Set timeout for acquire
            setTimeout(() => {
                const index = this.waitingQueue.indexOf(request);
                if (index !== -1) {
                    this.waitingQueue.splice(index, 1);
                    reject(new Error(`Timeout acquiring connection from pool '${this.name}' after ${this.config.acquireTimeoutMs}ms`));
                }
            }, this.config.acquireTimeoutMs);
            logger.debug(`Queued request for connection in pool '${this.name}', queue size: ${this.waitingQueue.length}`);
        });
    }
    release(connection) {
        if (!connection.acquired) {
            logger.warn(`Attempted to release non-acquired connection '${connection.id}' in pool '${this.name}'`);
            return;
        }
        connection.acquired = false;
        connection.lastUsed = new Date();
        logger.debug(`Released connection '${connection.id}' in pool '${this.name}'`);
        // Process waiting queue
        if (this.waitingQueue.length > 0) {
            const request = this.waitingQueue.shift();
            connection.acquired = true;
            request.resolve(connection);
            logger.debug(`Fulfilled queued request for connection '${connection.id}' in pool '${this.name}'`);
        }
    }
    removeConnection(connection) {
        const index = this.connections.indexOf(connection);
        if (index !== -1) {
            this.connections.splice(index, 1);
            // Try to disconnect gracefully
            try {
                if (connection.redis.status !== 'end') {
                    connection.redis.disconnect();
                }
            }
            catch (error) {
                logger.debug(`Error disconnecting connection '${connection.id}'`, error);
            }
            logger.debug(`Removed connection '${connection.id}' from pool '${this.name}'`);
            // Maintain minimum connections
            if (this.connections.length < this.config.minConnections && !this.closed) {
                this.createConnection().catch(error => {
                    logger.error(`Failed to maintain minimum connections for pool '${this.name}'`, error);
                });
            }
        }
    }
    startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
            this.cleanupIdleConnections();
        }, this.config.healthCheckInterval);
    }
    async performHealthCheck() {
        const unhealthyConnections = [];
        for (const connection of this.connections) {
            if (!connection.acquired) {
                try {
                    await connection.redis.ping();
                }
                catch (error) {
                    logger.warn(`Health check failed for connection '${connection.id}' in pool '${this.name}'`, error);
                    unhealthyConnections.push(connection);
                }
            }
        }
        // Remove unhealthy connections
        for (const connection of unhealthyConnections) {
            this.removeConnection(connection);
        }
        if (unhealthyConnections.length > 0) {
            logger.info(`Removed ${unhealthyConnections.length} unhealthy connections from pool '${this.name}'`);
        }
    }
    cleanupIdleConnections() {
        const now = Date.now();
        const idleConnections = this.connections.filter(conn => !conn.acquired &&
            (now - conn.lastUsed.getTime()) > this.config.idleTimeoutMs &&
            this.connections.length > this.config.minConnections);
        for (const connection of idleConnections) {
            this.removeConnection(connection);
        }
        if (idleConnections.length > 0) {
            logger.debug(`Cleaned up ${idleConnections.length} idle connections from pool '${this.name}'`);
        }
    }
    setupConnectionPoolMonitoring() {
        // Monitor pool performance metrics
        PerformanceMonitor.createConnectionPoolMonitor(this.name, () => ({
            totalConnections: this.connections.length,
            activeConnections: this.connections.filter(c => c.acquired).length,
            idleConnections: this.connections.filter(c => !c.acquired).length,
            waitingClients: this.waitingQueue.length
        }));
    }
    getStats() {
        return {
            name: this.name,
            totalConnections: this.connections.length,
            activeConnections: this.connections.filter(c => c.acquired).length,
            idleConnections: this.connections.filter(c => !c.acquired).length,
            waitingClients: this.waitingQueue.length,
            minConnections: this.config.minConnections,
            maxConnections: this.config.maxConnections
        };
    }
    async close() {
        this.closed = true;
        // Clear health check interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        // Reject all waiting requests
        for (const request of this.waitingQueue) {
            request.reject(new Error(`Pool '${this.name}' is closing`));
        }
        this.waitingQueue.length = 0;
        // Disconnect all connections
        const disconnectPromises = this.connections.map(async (connection) => {
            try {
                if (connection.redis.status !== 'end') {
                    await connection.redis.disconnect();
                }
            }
            catch (error) {
                logger.debug(`Error disconnecting connection '${connection.id}' during pool close`, error);
            }
        });
        await Promise.all(disconnectPromises);
        this.connections.length = 0;
        logger.info(`Redis pool '${this.name}' closed`);
    }
}
