import { redisStreams } from './redis-streams.js';
import { logger } from '@discord-bot/logger';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
/**
 * Redis Streams Monitoring and Observability Service
 * Provides comprehensive metrics for streams, consumer groups, and performance
 */
export class RedisStreamsMonitoring {
    constructor(serviceName, monitoringIntervalMs = 30000) {
        this.serviceName = serviceName;
        this.monitoringIntervalMs = monitoringIntervalMs;
        this.isInitialized = false;
        // Create a separate registry for this instance
        this.register = new Registry();
        // Initialize metrics with the separate registry
        this.streamMessages = new Counter({
            name: `redis_streams_messages_total_${serviceName}`,
            help: 'Total number of messages added to streams',
            labelNames: ['stream_name', 'service'],
            registers: [this.register]
        });
        this.streamPendingMessages = new Gauge({
            name: `redis_streams_pending_messages_current_${serviceName}`,
            help: 'Current number of pending messages in consumer groups',
            labelNames: ['stream_name', 'consumer_group', 'consumer_name'],
            registers: [this.register]
        });
        this.commandProcessingDuration = new Histogram({
            name: `redis_streams_command_processing_duration_seconds_${serviceName}`,
            help: 'Time taken to process commands via Redis Streams',
            labelNames: ['command_type', 'service', 'status'],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
            registers: [this.register]
        });
        this.consumerErrors = new Counter({
            name: `redis_streams_consumer_errors_total_${serviceName}`,
            help: 'Total number of consumer errors',
            labelNames: ['stream_name', 'consumer_group', 'error_type'],
            registers: [this.register]
        });
        this.connectionHealth = new Gauge({
            name: `redis_streams_connection_healthy_${serviceName}`,
            help: 'Redis Streams connection health status (1 = healthy, 0 = unhealthy)',
            labelNames: ['service'],
            registers: [this.register]
        });
        this.responseLatency = new Histogram({
            name: `redis_streams_response_latency_seconds_${serviceName}`,
            help: 'Latency for command responses via Redis Streams',
            labelNames: ['command_type', 'service'],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
            registers: [this.register]
        });
        this.consumerGroupLag = new Gauge({
            name: `redis_streams_consumer_group_lag_messages_${serviceName}`,
            help: 'Number of messages behind the stream head for each consumer group',
            labelNames: ['stream_name', 'consumer_group'],
            registers: [this.register]
        });
        this.activeConsumers = new Gauge({
            name: `redis_streams_active_consumers_current_${serviceName}`,
            help: 'Current number of active consumers in consumer groups',
            labelNames: ['stream_name', 'consumer_group'],
            registers: [this.register]
        });
    }
    /**
     * Initialize monitoring and start metric collection
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            // Set initial connection health
            this.updateConnectionHealth(true);
            // Start periodic monitoring
            this.startPeriodicMonitoring();
            this.isInitialized = true;
            logger.info({ serviceName: this.serviceName }, 'Redis Streams monitoring initialized');
        }
        catch (error) {
            logger.error({ error, serviceName: this.serviceName }, 'Failed to initialize Redis Streams monitoring');
            throw error;
        }
    }
    /**
     * Record a message added to stream
     */
    recordMessageAdded(streamName) {
        this.streamMessages.inc({ stream_name: streamName, service: this.serviceName });
    }
    /**
     * Record command processing time
     */
    recordCommandProcessingTime(commandType, status, durationSeconds) {
        this.commandProcessingDuration
            .labels({ command_type: commandType, service: this.serviceName, status })
            .observe(durationSeconds);
    }
    /**
     * Record response latency
     */
    recordResponseLatency(commandType, latencySeconds) {
        this.responseLatency
            .labels({ command_type: commandType, service: this.serviceName })
            .observe(latencySeconds);
    }
    /**
     * Record consumer error
     */
    recordConsumerError(streamName, consumerGroup, errorType) {
        this.consumerErrors.inc({
            stream_name: streamName,
            consumer_group: consumerGroup,
            error_type: errorType
        });
    }
    /**
     * Update connection health status
     */
    updateConnectionHealth(isHealthy) {
        this.connectionHealth.set({ service: this.serviceName }, isHealthy ? 1 : 0);
    }
    /**
     * Start periodic monitoring of stream metrics
     */
    startPeriodicMonitoring() {
        this.monitoringInterval = setInterval(async () => {
            try {
                await this.collectStreamMetrics();
            }
            catch (error) {
                logger.error({ error, serviceName: this.serviceName }, 'Error collecting stream metrics');
            }
        }, this.monitoringIntervalMs);
    }
    /**
     * Collect metrics from Redis Streams
     */
    async collectStreamMetrics() {
        try {
            const streams = [
                'discord-bot:audio-commands',
                'discord-bot:audio-responses',
                'discord-bot:gateway-commands',
                'discord-bot:gateway-responses'
            ];
            for (const streamName of streams) {
                await this.collectStreamInfo(streamName);
                await this.collectConsumerGroupInfo(streamName);
            }
            // Update connection health
            this.updateConnectionHealth(true);
        }
        catch (error) {
            logger.error({ error, serviceName: this.serviceName }, 'Failed to collect stream metrics');
            this.updateConnectionHealth(false);
        }
    }
    /**
     * Collect stream information
     */
    async collectStreamInfo(streamName) {
        try {
            const streamInfo = await redisStreams.getStreamInfo(streamName);
            // Note: Implementation depends on RedisStreamsManager providing this method
            logger.debug({ streamName, streamInfo }, 'Collected stream info');
        }
        catch (error) {
            // Stream might not exist yet, which is normal
            logger.debug({ error, streamName }, 'Could not collect stream info');
        }
    }
    /**
     * Collect consumer group information
     */
    async collectConsumerGroupInfo(streamName) {
        try {
            const consumerGroups = ['audio-processors', 'gateway-processors'];
            for (const groupName of consumerGroups) {
                try {
                    const groupInfo = await redisStreams.getConsumerGroupInfo(streamName, groupName);
                    // Note: Implementation depends on RedisStreamsManager providing this method
                    logger.debug({ streamName, groupName, groupInfo }, 'Collected consumer group info');
                }
                catch (error) {
                    // Consumer group might not exist yet, which is normal
                    logger.debug({ error, streamName, groupName }, 'Could not collect consumer group info');
                }
            }
        }
        catch (error) {
            logger.debug({ error, streamName }, 'Could not collect consumer group information');
        }
    }
    /**
     * Get current monitoring statistics
     */
    getStats() {
        return {
            isInitialized: this.isInitialized,
            serviceName: this.serviceName,
            monitoringIntervalMs: this.monitoringIntervalMs
        };
    }
    /**
     * Shutdown monitoring and cleanup resources
     */
    async shutdown() {
        logger.info({ serviceName: this.serviceName }, 'Shutting down Redis Streams monitoring...');
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        // Set connection health to unhealthy
        this.updateConnectionHealth(false);
        this.isInitialized = false;
        logger.info({ serviceName: this.serviceName }, 'Redis Streams monitoring shutdown complete');
    }
}
// Export monitoring instances for different services
export const audioStreamsMonitoring = new RedisStreamsMonitoring('audio');
export const gatewayStreamsMonitoring = new RedisStreamsMonitoring('gateway');
