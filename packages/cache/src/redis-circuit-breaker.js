import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { CircuitBreakerManager } from './circuit-breaker.js';
export class RedisCircuitBreaker {
    constructor(name, config, redisOptions) {
        this.name = name;
        this.config = config;
        this.fallbackCache = new Map();
        this.fallbackTTL = 300000; // 5 minutes
        // Message buffering for failed PUBLISH operations
        this.messageBuffer = [];
        this.maxBufferSize = 100;
        this.bufferMessageTTL = 300000; // 5 minutes
        this.bufferCleanupIntervalMs = 60000; // 1 minute
        // Metrics for message buffering
        this.metrics = {
            messagesBuffered: 0,
            messagesReplayed: 0,
            messagesDropped: 0
        };
        this.circuitBreaker = CircuitBreakerManager.getInstance().getCircuit(`redis-${name}`, config);
        // Initialize fallback cache configuration
        this.fallbackCacheMaxSize = config.fallbackCache?.maxSize ?? 100;
        this.cleanupIntervalMs = config.fallbackCache?.cleanupIntervalMs ?? 300000; // 5 minutes
         
        this.redis = new Redis(redisOptions);
        this.redis.on('error', (error) => {
            logger.error({
                circuit: this.name,
                error: error.message
            }, 'Redis connection error');
        });
        this.redis.on('connect', () => {
            logger.info({ circuit: this.name }, 'Redis connected');
        });
        this.redis.on('reconnecting', () => {
            logger.warn({ circuit: this.name }, 'Redis reconnecting');
        });
        // Setup periodic cleanup for fallback cache and message buffer
        this.setupPeriodicCleanup();
        this.setupBufferCleanup();
    }
    async get(key) {
        return this.circuitBreaker.execute(async () => {
            const result = await this.redis.get(key);
            return result;
        }, () => this.getFallback(key));
    }
    async set(key, value, mode, duration) {
        return this.circuitBreaker.execute(async () => {
            if (mode && duration) {
                return await this.redis.set(key, value, mode, duration);
            }
            return await this.redis.set(key, value);
        }, () => this.setFallback(key, value, duration));
    }
    async incr(key) {
        return this.circuitBreaker.execute(async () => {
            return await this.redis.incr(key);
        }, () => this.incrFallback(key));
    }
    async expire(key, seconds) {
        return this.circuitBreaker.execute(async () => {
            return await this.redis.expire(key, seconds);
        }, () => this.expireFallback(key, seconds));
    }
    async publish(channel, message) {
        return this.circuitBreaker.execute(async () => {
            const result = await this.redis.publish(channel, message);
            // If message was successfully published and buffer has items, attempt replay
            if (result > 0 && this.messageBuffer.length > 0) {
                await this.replayBufferedMessages();
            }
            return result;
        }, () => {
            // Buffer the failed message instead of dropping it
            this.bufferMessage(channel, message);
            logger.warn({
                circuit: this.name,
                channel,
                messageLength: message.length,
                bufferSize: this.messageBuffer.length,
                maxBufferSize: this.maxBufferSize
            }, 'Redis publish failed, message buffered');
            return 0; // Still return 0 as message wasn't delivered immediately
        });
    }
    async ping() {
        return this.circuitBreaker.execute(async () => {
            return await this.redis.ping();
        }, () => {
            logger.warn({
                circuit: this.name
            }, 'Redis ping failed, returning fallback');
            return 'PONG'; // Fake healthy response for fallback
        });
    }
    async subscribe(channel) {
        return this.circuitBreaker.execute(async () => {
            await this.redis.subscribe(channel);
        }, () => {
            logger.warn({
                circuit: this.name,
                channel
            }, 'Redis subscribe failed, no fallback available');
            throw new Error(`Cannot subscribe to ${channel} - Redis circuit breaker is open`);
        });
    }
    getFallback(key) {
        const cached = this.fallbackCache.get(key);
        if (!cached)
            return null;
        if (Date.now() > cached.expiry) {
            this.fallbackCache.delete(key);
            logger.debug({
                circuit: this.name,
                key,
                reason: 'expired'
            }, 'Removed expired entry from fallback cache');
            return null;
        }
        // Update last accessed time for LRU tracking
        cached.lastAccessed = Date.now();
        logger.debug({
            circuit: this.name,
            key,
            source: 'fallback-cache'
        }, 'Using fallback cache value');
        return cached.value;
    }
    setFallback(key, value, ttlSeconds) {
        const now = Date.now();
        const expiry = now + (ttlSeconds ? ttlSeconds * 1000 : this.fallbackTTL);
        // Check if we need to evict entries before adding new one
        if (this.fallbackCache.size >= this.fallbackCacheMaxSize && !this.fallbackCache.has(key)) {
            this.evictLRUEntries(1);
        }
        this.fallbackCache.set(key, {
            value: value,
            expiry,
            lastAccessed: now
        });
        logger.debug({
            circuit: this.name,
            key,
            ttl: ttlSeconds,
            cacheSize: this.fallbackCache.size,
            maxSize: this.fallbackCacheMaxSize
        }, 'Stored value in fallback cache');
        return 'OK';
    }
    incrFallback(key) {
        const current = this.getFallback(key);
        const newValue = (current ? parseInt(current, 10) : 0) + 1;
        this.setFallback(key, newValue.toString());
        return newValue;
    }
    expireFallback(key, seconds) {
        const cached = this.fallbackCache.get(key);
        if (!cached)
            return 0;
        cached.expiry = Date.now() + (seconds * 1000);
        return 1;
    }
    setupPeriodicCleanup() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredEntries();
        }, this.cleanupIntervalMs);
        logger.debug({
            circuit: this.name,
            intervalMs: this.cleanupIntervalMs
        }, 'Setup periodic fallback cache cleanup');
    }
    cleanupExpiredEntries() {
        const now = Date.now();
        let removed = 0;
        const initialSize = this.fallbackCache.size;
        for (const [key, cached] of this.fallbackCache.entries()) {
            if (now > cached.expiry) {
                this.fallbackCache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            logger.info({
                circuit: this.name,
                removed,
                initialSize,
                remaining: this.fallbackCache.size,
                operation: 'expired-cleanup'
            }, 'Cleaned up expired fallback cache entries');
        }
    }
    evictLRUEntries(count) {
        if (this.fallbackCache.size === 0)
            return;
        // Convert to array and sort by lastAccessed (oldest first)
        const entries = Array.from(this.fallbackCache.entries())
            .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
        let evicted = 0;
        for (let i = 0; i < Math.min(count, entries.length); i++) {
            const [key] = entries[i];
            this.fallbackCache.delete(key);
            evicted++;
        }
        if (evicted > 0) {
            logger.info({
                circuit: this.name,
                evicted,
                remaining: this.fallbackCache.size,
                maxSize: this.fallbackCacheMaxSize,
                operation: 'lru-eviction'
            }, 'Evicted LRU entries from fallback cache');
        }
    }
    /**
     * Buffer a failed publish message for later replay
     * Uses FIFO eviction when buffer is full (max 100 messages)
     */
    bufferMessage(channel, message) {
        const bufferedMessage = {
            channel,
            message,
            timestamp: Date.now()
        };
        // Check if we need to evict oldest message (FIFO)
        if (this.messageBuffer.length >= this.maxBufferSize) {
            const evicted = this.messageBuffer.shift();
            this.metrics.messagesDropped++;
            logger.warn({
                circuit: this.name,
                channel: evicted?.channel,
                operation: 'fifo-eviction',
                bufferSize: this.messageBuffer.length,
                totalMessagesDropped: this.metrics.messagesDropped
            }, 'Message buffer full, evicting oldest message (FIFO)');
        }
        // Add message to buffer
        this.messageBuffer.push(bufferedMessage);
        this.metrics.messagesBuffered++;
        logger.debug({
            circuit: this.name,
            channel,
            bufferSize: this.messageBuffer.length,
            totalMessagesBuffered: this.metrics.messagesBuffered
        }, 'Message added to buffer');
    }
    /**
     * Replay all buffered messages in order (FIFO)
     * Stops on first error and logs failure
     */
    async replayBufferedMessages() {
        if (this.messageBuffer.length === 0)
            return;
        const messages = [...this.messageBuffer]; // Copy to avoid modification during iteration
        let replayed = 0;
        for (const bufferedMessage of messages) {
            try {
                const result = await this.redis.publish(bufferedMessage.channel, bufferedMessage.message);
                if (result > 0) {
                    // Message was successfully published, remove from buffer
                    this.messageBuffer.shift();
                    replayed++;
                    this.metrics.messagesReplayed++;
                    logger.debug({
                        circuit: this.name,
                        channel: bufferedMessage.channel,
                        operation: 'message-replayed',
                        bufferSize: this.messageBuffer.length,
                        totalMessagesReplayed: this.metrics.messagesReplayed
                    }, 'Buffered message replayed');
                }
                else {
                    // Redis returned 0 subscribers, stop replay attempt
                    logger.debug({
                        circuit: this.name,
                        channel: bufferedMessage.channel,
                        reason: 'no-subscribers'
                    }, 'Buffered message not delivered (no subscribers)');
                    break;
                }
            }
            catch (error) {
                // Error during replay, stop attempt and keep remaining messages in buffer
                logger.warn({
                    circuit: this.name,
                    channel: bufferedMessage.channel,
                    error: error instanceof Error ? error.message : String(error),
                    remainingInBuffer: this.messageBuffer.length - replayed,
                    operation: 'replay-failure'
                }, 'Error replaying buffered message, stopping replay');
                break;
            }
        }
        if (replayed > 0) {
            logger.info({
                circuit: this.name,
                messagesReplayed: replayed,
                remainingInBuffer: this.messageBuffer.length,
                totalReplayed: this.metrics.messagesReplayed
            }, 'Batch replay of buffered messages completed');
        }
    }
    /**
     * Periodically clean up expired messages from buffer (TTL: 5 minutes)
     */
    setupBufferCleanup() {
        this.bufferCleanupTimer = setInterval(() => {
            this.cleanupExpiredMessages();
        }, this.bufferCleanupIntervalMs);
        logger.debug({
            circuit: this.name,
            intervalMs: this.bufferCleanupIntervalMs,
            messageTTL: this.bufferMessageTTL
        }, 'Setup periodic message buffer cleanup');
    }
    /**
     * Remove expired messages from buffer based on TTL
     */
    cleanupExpiredMessages() {
        const now = Date.now();
        let removed = 0;
        const initialSize = this.messageBuffer.length;
        // Remove messages older than 5 minutes
        this.messageBuffer = this.messageBuffer.filter((msg) => {
            if (now - msg.timestamp > this.bufferMessageTTL) {
                removed++;
                return false;
            }
            return true;
        });
        if (removed > 0) {
            logger.info({
                circuit: this.name,
                removed,
                initialSize,
                remaining: this.messageBuffer.length,
                operation: 'message-buffer-ttl-cleanup'
            }, 'Cleaned up expired messages from buffer');
        }
    }
    getMetrics() {
        return {
            ...this.circuitBreaker.getMetrics(),
            fallbackCache: {
                size: this.fallbackCache.size,
                maxSize: this.fallbackCacheMaxSize,
                utilizationPercent: (this.fallbackCache.size / this.fallbackCacheMaxSize) * 100
            },
            messageBuffer: {
                currentSize: this.messageBuffer.length,
                maxSize: this.maxBufferSize,
                utilizationPercent: (this.messageBuffer.length / this.maxBufferSize) * 100,
                metrics: {
                    messagesBuffered: this.metrics.messagesBuffered,
                    messagesReplayed: this.metrics.messagesReplayed,
                    messagesDropped: this.metrics.messagesDropped
                }
            },
            redisStatus: this.redis.status
        };
    }
    async disconnect() {
        // Clear cleanup timers
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        if (this.bufferCleanupTimer) {
            clearInterval(this.bufferCleanupTimer);
            this.bufferCleanupTimer = undefined;
        }
        await this.redis.disconnect();
        const cacheSize = this.fallbackCache.size;
        const bufferSize = this.messageBuffer.length;
        this.fallbackCache.clear();
        this.messageBuffer = [];
        logger.info({
            circuit: this.name,
            clearedCacheEntries: cacheSize,
            clearedBufferedMessages: bufferSize,
            bufferMetrics: this.metrics
        }, 'Redis circuit breaker disconnected');
    }
}
