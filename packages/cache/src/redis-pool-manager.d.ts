import Redis, { RedisOptions } from 'ioredis';
export interface RedisPoolConfig {
    maxConnections: number;
    minConnections: number;
    acquireTimeoutMs: number;
    idleTimeoutMs: number;
    redisOptions: RedisOptions;
    healthCheckInterval: number;
    maxRetries: number;
}
export interface PoolConnection {
    id: string;
    redis: Redis;
    acquired: boolean;
    lastUsed: Date;
    createdAt: Date;
}
export declare class RedisPoolManager {
    private static instance;
    private pools;
    static getInstance(): RedisPoolManager;
    createPool(name: string, config: RedisPoolConfig): RedisConnectionPool;
    getPool(name: string): RedisConnectionPool | undefined;
    closeAllPools(): Promise<void>;
    getPoolStats(): Record<string, any>;
}
export declare class RedisConnectionPool {
    private readonly name;
    private readonly config;
    private connections;
    private waitingQueue;
    private healthCheckInterval;
    private connectionIdCounter;
    private closed;
    constructor(name: string, config: RedisPoolConfig);
    private initialize;
    private createConnection;
    acquire(): Promise<PoolConnection>;
    release(connection: PoolConnection): void;
    private removeConnection;
    private startHealthCheck;
    private performHealthCheck;
    private cleanupIdleConnections;
    private setupConnectionPoolMonitoring;
    getStats(): {
        name: string;
        totalConnections: number;
        activeConnections: number;
        idleConnections: number;
        waitingClients: number;
        minConnections: number;
        maxConnections: number;
    };
    close(): Promise<void>;
}
//# sourceMappingURL=redis-pool-manager.d.ts.map