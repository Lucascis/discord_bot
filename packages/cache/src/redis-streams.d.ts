import type Redis from 'ioredis';
export interface StreamMessage {
    id: string;
    data: Record<string, string>;
}
export interface StreamCommandData {
    type: string;
    guildId: string;
    requestId: string;
    timestamp: string;
    [key: string]: string;
}
export interface StreamResponseData {
    requestId: string;
    data: string;
    timestamp: string;
    [key: string]: string;
}
/**
 * Redis Streams Configuration for Microservices Communication
 * Provides reliable message delivery with at-least-once semantics
 */
export declare class RedisStreamsManager {
    private client;
    private isConnected;
    private consumers;
    static readonly STREAMS: {
        readonly AUDIO_COMMANDS: "discord-bot:audio-commands";
        readonly AUDIO_RESPONSES: "discord-bot:audio-responses";
        readonly GATEWAY_COMMANDS: "discord-bot:gateway-commands";
        readonly GATEWAY_RESPONSES: "discord-bot:gateway-responses";
    };
    static readonly CONSUMER_GROUPS: {
        readonly AUDIO_PROCESSORS: "audio-processors";
        readonly GATEWAY_PROCESSORS: "gateway-processors";
        readonly RESPONSE_HANDLERS: "response-handlers";
    };
    constructor();
    /**
     * Connect to Redis and initialize streams and consumer groups
     */
    connect(): Promise<void>;
    /**
     * Initialize streams and consumer groups
     * Creates streams and groups if they don't exist
     */
    private initializeStreamsAndGroups;
    /**
     * Add a message to a stream
     */
    addToStream(streamName: string, data: Record<string, string>): Promise<string>;
    /**
     * Read messages from a stream using consumer group
     */
    readFromStreamGroup(streamName: string, groupName: string, consumerName: string, options?: {
        count?: number;
        block?: number;
    }): Promise<StreamMessage[]>;
    /**
     * Acknowledge message processing
     */
    acknowledgeMessage(streamName: string, groupName: string, messageId: string): Promise<void>;
    /**
     * Get stream information for monitoring
     */
    getStreamInfo(streamName: string): Promise<any>;
    /**
     * Get consumer group information for monitoring
     */
    getGroupInfo(streamName: string): Promise<any>;
    /**
     * Get pending messages for a consumer group
     */
    getPendingMessages(streamName: string, groupName: string): Promise<any>;
    /**
     * Start a consumer for continuous message processing
     */
    startConsumer(streamName: string, groupName: string, consumerName: string, processor: (message: StreamMessage) => Promise<void>, options?: {
        count?: number;
        block?: number;
    }): Promise<void>;
    /**
     * Stop a consumer
     */
    stopConsumer(consumerKey: string): void;
    /**
     * Stop all consumers and disconnect
     */
    disconnect(): Promise<void>;
    /**
     * Get consumer group information for monitoring
     */
    getConsumerGroupInfo(streamName: string, groupName: string): Promise<any>;
    /**
     * Get the underlying Redis client for advanced operations
     */
    getClient(): Redis;
}
export declare const redisStreams: RedisStreamsManager;
//# sourceMappingURL=redis-streams.d.ts.map
