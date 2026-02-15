import Redis from 'ioredis';
import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';

export class RedisManager {
    private redisClient!: Redis;
    private redisSubscriber!: Redis;
    private audioRedisClient!: Redis;
    private readonly channelHandlers = new Map<string, (message: string, channel: string) => void>();

    constructor() {
        this.initializeClients();
    }

    private initializeClients(): void {
        // Initialize Redis client with enterprise configuration
        this.redisClient = new Redis(env.REDIS_URL, {
            connectTimeout: 5000,
            keepAlive: 5000,
            noDelay: true,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            lazyConnect: true
        });

        // Create separate Redis client for subscriptions
        this.redisSubscriber = new Redis(env.REDIS_URL, {
            connectTimeout: 5000,
            keepAlive: 5000,
            noDelay: true,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            lazyConnect: true
        });

        // Create dedicated Redis client for raw Discord events to Audio service
        this.audioRedisClient = new Redis(env.REDIS_URL, {
            connectTimeout: 5000,
            keepAlive: 5000,
            noDelay: true,
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            lazyConnect: true
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        // Redis Subscriber Reconnection Handler
        this.redisSubscriber.on('reconnecting', () => {
            logger.warn('Redis subscriber connection lost, attempting to reconnect...');
        });

        this.redisSubscriber.on('connect', async () => {
            logger.info('Redis subscriber reconnected successfully');
            // Re-subscription logic will be handled by the consumer of this manager
            // via a callback or event if needed, but for now we just log
        });

        this.redisSubscriber.on('error', (error: Error) => {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Redis subscriber connection error');
        });
        this.redisSubscriber.on('message', (channel: string, message: string) => {
            const handler = this.channelHandlers.get(channel);
            if (handler) {
                handler(message, channel);
            }
        });

        // Audio Redis Client Reconnection Handler
        this.audioRedisClient.on('reconnecting', () => {
            logger.warn('Audio Redis client connection lost, attempting to reconnect...');
        });

        this.audioRedisClient.on('connect', () => {
            logger.info('Audio Redis client reconnected successfully');
        });

        this.audioRedisClient.on('error', (error: Error) => {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Audio Redis client connection error');
        });

        // Main Redis Client Error Handler (for operations)
        this.redisClient.on('error', (error: Error) => {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Redis client connection error');
        });
    }

    public async connect(): Promise<void> {
        const connectIfNeeded = async (client: Redis): Promise<void> => {
            const status = client.status as string;
            if (status !== 'ready' && status !== 'connecting') {
                await client.connect();
            }
        };

        await Promise.all([
            connectIfNeeded(this.redisClient),
            connectIfNeeded(this.redisSubscriber),
            connectIfNeeded(this.audioRedisClient)
        ]);
        logger.info('Redis client, subscriber and audio client connected');
    }

    public getClient(): Redis {
        return this.redisClient;
    }

    public getSubscriber(): Redis {
        return this.redisSubscriber;
    }

    public getAudioClient(): Redis {
        return this.audioRedisClient;
    }

    public async publish(channel: string, message: unknown): Promise<void> {
        try {
            await this.redisClient.publish(channel, typeof message === 'string' ? message : JSON.stringify(message));
        } catch (error) {
            logger.error({ error, channel }, 'Failed to publish message to Redis');
            throw error;
        }
    }

    public async subscribe(channel: string, callback: (message: string, channel: string) => void): Promise<void> {
        try {
            await this.redisSubscriber.subscribe(channel);
            this.channelHandlers.set(channel, callback);
            logger.debug({ channel }, 'Subscribed to Redis channel');
        } catch (error) {
            logger.error({ error, channel }, 'Failed to subscribe to Redis channel');
            throw error;
        }
    }

    public async unsubscribe(channel: string): Promise<void> {
        try {
            await this.redisSubscriber.unsubscribe(channel);
            this.channelHandlers.delete(channel);
            logger.debug({ channel }, 'Unsubscribed from Redis channel');
        } catch (error) {
            logger.error({ error, channel }, 'Failed to unsubscribe from Redis channel');
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        await Promise.all([
            this.redisClient.quit(),
            this.redisSubscriber.quit(),
            this.audioRedisClient.quit()
        ]);
    }
}
