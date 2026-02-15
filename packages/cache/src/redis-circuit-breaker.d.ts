import { type CircuitBreakerConfig } from './circuit-breaker.js';
export interface RedisCircuitBreakerConfig extends CircuitBreakerConfig {
    redis: {
        retryDelayOnFailover: number;
        maxRetriesPerRequest: number;
        enableReadyCheck: boolean;
        lazyConnect: boolean;
    };
    fallbackCache?: {
        maxSize: number;
        cleanupIntervalMs: number;
    };
}
export declare class RedisCircuitBreaker {
    private readonly name;
    private readonly config;
    private circuitBreaker;
    private redis;
    private fallbackCache;
    private fallbackTTL;
    private readonly fallbackCacheMaxSize;
    private readonly cleanupIntervalMs;
    private cleanupTimer?;
    private messageBuffer;
    private readonly maxBufferSize;
    private readonly bufferMessageTTL;
    private readonly bufferCleanupIntervalMs;
    private bufferCleanupTimer?;
    private metrics;
    constructor(name: string, config: RedisCircuitBreakerConfig, redisOptions: Record<string, unknown>);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode?: 'EX', duration?: number): Promise<'OK' | null>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    publish(channel: string, message: string): Promise<number>;
    ping(): Promise<string>;
    subscribe(channel: string): Promise<void>;
    private getFallback;
    private setFallback;
    private incrFallback;
    private expireFallback;
    private setupPeriodicCleanup;
    private cleanupExpiredEntries;
    private evictLRUEntries;
    /**
     * Buffer a failed publish message for later replay
     * Uses FIFO eviction when buffer is full (max 100 messages)
     */
    private bufferMessage;
    /**
     * Replay all buffered messages in order (FIFO)
     * Stops on first error and logs failure
     */
    private replayBufferedMessages;
    /**
     * Periodically clean up expired messages from buffer (TTL: 5 minutes)
     */
    private setupBufferCleanup;
    /**
     * Remove expired messages from buffer based on TTL
     */
    private cleanupExpiredMessages;
    getMetrics(): {
        fallbackCache: {
            size: number;
            maxSize: number;
            utilizationPercent: number;
        };
        messageBuffer: {
            currentSize: number;
            maxSize: number;
            utilizationPercent: number;
            metrics: {
                messagesBuffered: number;
                messagesReplayed: number;
                messagesDropped: number;
            };
        };
        redisStatus: "connect" | "wait" | "reconnecting" | "connecting" | "ready" | "close" | "end";
        failures: number;
        successes: number;
        requests: number;
        state: import("./circuit-breaker.js").CircuitState;
        lastFailureTime?: number;
        stateChangeTime: number;
    };
    disconnect(): Promise<void>;
}
//# sourceMappingURL=redis-circuit-breaker.d.ts.map