import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import { RedisCircuitBreaker, type RedisCircuitBreakerConfig } from '@discord-bot/cache';

export class RedisManager {
    private publisher: RedisCircuitBreaker;
    private subscriber: Redis;
    private readonly channelHandlers = new Map<string, (message: string) => void>();
    private readonly redisUrl: string;

    constructor() {
        this.redisUrl = env.REDIS_URL || 'redis://localhost:6379';

        const redisCircuitConfig: RedisCircuitBreakerConfig = {
            failureThreshold: 0.5,
            timeout: 30000,
            monitoringWindow: 60000,
            volumeThreshold: 10,
            redis: {
                retryDelayOnFailover: 1000,
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: true,
            },
        };

        this.publisher = new RedisCircuitBreaker(
            'audio-pub',
            redisCircuitConfig,
            {
                host: this.redisUrl ? new URL(this.redisUrl).hostname : 'localhost',
                port: this.redisUrl ? parseInt(new URL(this.redisUrl).port) || 6379 : 6379,
                password: this.redisUrl ? new URL(this.redisUrl).password || undefined : undefined,
                retryDelayOnFailover: 1000,
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: false, // CRITICAL FIX: Force immediate connection
            }
        );

        this.subscriber = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            lazyConnect: true,
            retryStrategy: (times: number) => Math.min(times * 100, 3000)
        });
        this.setupReconnectionHandlers();
    }

    public async connect(): Promise<void> {
        try {
            const status = this.subscriber.status as string;
            if (status !== 'ready' && status !== 'connecting') {
                await this.subscriber.connect();
            }
            logger.info('✅ Redis subscriber connected');

            // Publisher connects on demand via CircuitBreaker, but we can verify it here if needed
            // For now, we rely on the lazyConnect: false to have established it
        } catch (error) {
            logger.error({ error }, '❌ Failed to connect to Redis');
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await this.subscriber.quit();
            await this.publisher.disconnect();
            logger.info('🛑 Redis connections closed');
        } catch (error) {
            logger.error({ error }, 'Error closing Redis connections');
        }
    }

    public getSubscriber(): Redis {
        return this.subscriber;
    }

    public getPublisher(): RedisCircuitBreaker {
        return this.publisher;
    }

    public async publish(channel: string, message: string): Promise<void> {
        await this.publisher.publish(channel, message);
    }

    public async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
        await this.subscriber.subscribe(channel);
        this.channelHandlers.set(channel, handler);
    }

    private setupReconnectionHandlers(): void {
        this.subscriber.on('error', (err) => {
            logger.error({ err }, 'Redis Subscriber Error');
        });

        this.subscriber.on('reconnecting', () => {
            logger.warn('Redis Subscriber reconnecting...');
        });

        this.subscriber.on('ready', () => {
            logger.info('Redis Subscriber ready');
        });

        this.subscriber.on('message', (channel: string, message: string) => {
            const handler = this.channelHandlers.get(channel);
            if (handler) {
                handler(message);
            }
        });
    }
}
