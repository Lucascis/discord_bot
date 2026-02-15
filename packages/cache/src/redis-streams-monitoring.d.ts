/**
 * Redis Streams Monitoring and Observability Service
 * Provides comprehensive metrics for streams, consumer groups, and performance
 */
export declare class RedisStreamsMonitoring {
    private serviceName;
    private monitoringIntervalMs;
    private register;
    private streamMessages;
    private streamPendingMessages;
    private commandProcessingDuration;
    private consumerErrors;
    private connectionHealth;
    private responseLatency;
    private consumerGroupLag;
    private activeConsumers;
    private monitoringInterval?;
    private isInitialized;
    constructor(serviceName: string, monitoringIntervalMs?: number);
    /**
     * Initialize monitoring and start metric collection
     */
    initialize(): Promise<void>;
    /**
     * Record a message added to stream
     */
    recordMessageAdded(streamName: string): void;
    /**
     * Record command processing time
     */
    recordCommandProcessingTime(commandType: string, status: 'success' | 'error', durationSeconds: number): void;
    /**
     * Record response latency
     */
    recordResponseLatency(commandType: string, latencySeconds: number): void;
    /**
     * Record consumer error
     */
    recordConsumerError(streamName: string, consumerGroup: string, errorType: string): void;
    /**
     * Update connection health status
     */
    updateConnectionHealth(isHealthy: boolean): void;
    /**
     * Start periodic monitoring of stream metrics
     */
    private startPeriodicMonitoring;
    /**
     * Collect metrics from Redis Streams
     */
    private collectStreamMetrics;
    /**
     * Collect stream information
     */
    private collectStreamInfo;
    /**
     * Collect consumer group information
     */
    private collectConsumerGroupInfo;
    /**
     * Get current monitoring statistics
     */
    getStats(): {
        isInitialized: boolean;
        serviceName: string;
        monitoringIntervalMs: number;
    };
    /**
     * Shutdown monitoring and cleanup resources
     */
    shutdown(): Promise<void>;
}
export declare const audioStreamsMonitoring: RedisStreamsMonitoring;
export declare const gatewayStreamsMonitoring: RedisStreamsMonitoring;
//# sourceMappingURL=redis-streams-monitoring.d.ts.map