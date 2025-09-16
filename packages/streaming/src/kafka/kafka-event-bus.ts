import { Kafka, Consumer, Producer, KafkaMessage, EachMessagePayload } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import type { DomainEvent } from '@discord-bot/event-store';

/**
 * Kafka Configuration
 */
export interface KafkaConfig {
  /** Kafka broker addresses */
  brokers: string[];

  /** Client ID for this service */
  clientId: string;

  /** Consumer group ID */
  groupId: string;

  /** Security configuration */
  security?: {
    sasl?: {
      mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
      username: string;
      password: string;
    };
    ssl?: boolean;
  };

  /** Connection settings */
  connection: {
    /** Connection timeout (ms) */
    connectionTimeout: number;

    /** Request timeout (ms) */
    requestTimeout: number;

    /** Retry configuration */
    retry: {
      retries: number;
      initialRetryTime: number;
      maxRetryTime: number;
    };
  };

  /** Topic configuration */
  topics: {
    /** Event topic prefix */
    eventTopicPrefix: string;

    /** Number of partitions for new topics */
    defaultPartitions: number;

    /** Replication factor for new topics */
    replicationFactor: number;

    /** Topic configuration overrides */
    topicConfigs: Record<string, string>;
  };

  /** Performance settings */
  performance: {
    /** Producer batch size */
    batchSize: number;

    /** Producer linger time (ms) */
    lingerMs: number;

    /** Consumer max bytes per partition */
    maxBytesPerPartition: number;

    /** Consumer heartbeat interval (ms) */
    heartbeatInterval: number;

    /** Consumer session timeout (ms) */
    sessionTimeout: number;
  };

  /** Schema registry settings */
  schemaRegistry?: {
    url: string;
    auth?: {
      username: string;
      password: string;
    };
  };
}

/**
 * Event Processor Interface
 */
export interface EventProcessor {
  eventType: string;
  process(event: DomainEvent, metadata: EventMetadata): Promise<void>;
}

/**
 * Event Metadata
 */
export interface EventMetadata {
  topic: string;
  partition: number;
  offset: string;
  timestamp: Date;
  headers: Record<string, string>;
  key: string | null;
}

/**
 * Kafka Event Bus Metrics
 */
export interface KafkaEventBusMetrics {
  // Producer metrics
  messagesSent: number;
  messagesFailedToSend: number;
  avgSendTime: number;

  // Consumer metrics
  messagesReceived: number;
  messagesProcessed: number;
  messagesFailedToProcess: number;
  avgProcessingTime: number;

  // Connection metrics
  connectionErrors: number;
  reconnections: number;

  // Topic metrics
  topicsCreated: number;

  // Lag metrics
  consumerLag: number;
}

/**
 * Kafka Event Bus Implementation
 * High-performance event streaming with Apache Kafka
 */
export class KafkaEventBus {
  private readonly kafka: Kafka;
  private readonly config: KafkaConfig;
  private readonly metrics?: MetricsCollector;

  private producer?: Producer;
  private consumer?: Consumer;
  private readonly processors = new Map<string, EventProcessor>();
  private isConnected = false;

  // Metrics tracking
  private messagesSent = 0;
  private messagesFailedToSend = 0;
  private totalSendTime = 0;
  private messagesReceived = 0;
  private messagesProcessed = 0;
  private messagesFailedToProcess = 0;
  private totalProcessingTime = 0;
  private connectionErrors = 0;
  private reconnections = 0;
  private topicsCreated = 0;

  constructor(config: KafkaConfig, metrics?: MetricsCollector) {
    this.config = config;
    this.metrics = metrics;

    // Initialize Kafka client
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      connectionTimeout: config.connection.connectionTimeout,
      requestTimeout: config.connection.requestTimeout,
      retry: config.connection.retry,
      ssl: config.security?.ssl,
      sasl: config.security?.sasl as any,
      logLevel: 2, // WARN level
    });

    logger.info('Kafka Event Bus initialized', {
      clientId: config.clientId,
      brokers: config.brokers,
      groupId: config.groupId
    });
  }

  /**
   * Connect to Kafka cluster
   */
  async connect(): Promise<void> {
    try {
      // Initialize producer
      this.producer = this.kafka.producer({
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000,
        retry: this.config.connection.retry,
        allowAutoTopicCreation: true,
        // compression: 'gzip', // Property doesn't exist in ProducerConfig
        // batchSize: this.config.performance.batchSize, // Property doesn't exist
        // linger: this.config.performance.lingerMs, // Property doesn't exist
      });

      await this.producer.connect();

      // Initialize consumer
      this.consumer = this.kafka.consumer({
        groupId: this.config.groupId,
        sessionTimeout: this.config.performance.sessionTimeout,
        heartbeatInterval: this.config.performance.heartbeatInterval,
        maxBytesPerPartition: this.config.performance.maxBytesPerPartition,
        allowAutoTopicCreation: true,
        retry: this.config.connection.retry,
      });

      await this.consumer.connect();

      // Setup error handlers
      this.setupErrorHandlers();

      this.isConnected = true;

      logger.info('Kafka Event Bus connected successfully', {
        clientId: this.config.clientId
      });

    } catch (error) {
      this.connectionErrors++;
      this.recordMetrics();

      logger.error('Failed to connect to Kafka', {
        error: error instanceof Error ? error.message : String(error),
        brokers: this.config.brokers
      });

      throw error;
    }
  }

  /**
   * Disconnect from Kafka cluster
   */
  async disconnect(): Promise<void> {
    try {
      if (this.consumer) {
        await this.consumer.disconnect();
      }

      if (this.producer) {
        await this.producer.disconnect();
      }

      this.isConnected = false;

      logger.info('Kafka Event Bus disconnected');

    } catch (error) {
      logger.error('Error disconnecting from Kafka', {
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Publish domain event to Kafka
   */
  async publishEvent(event: DomainEvent): Promise<void> {
    if (!this.producer || !this.isConnected) {
      throw new Error('Kafka Event Bus is not connected');
    }

    const topic = this.getTopicName(event.eventType);
    const key = event.aggregateId;
    const value = JSON.stringify(event);

    const startTime = Date.now();

    try {
      await this.producer.send({
        topic,
        messages: [{
          key,
          value,
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            correlationId: event.metadata.correlationId || '',
            timestamp: event.timestamp.toISOString(),
            source: event.metadata.source,
            version: event.metadata.version,
          },
          timestamp: event.timestamp.getTime().toString(),
        }]
      });

      // Record success metrics
      this.messagesSent++;
      this.totalSendTime += Date.now() - startTime;
      this.recordMetrics();

      logger.debug('Event published to Kafka', {
        eventId: event.eventId,
        eventType: event.eventType,
        topic,
        aggregateId: event.aggregateId
      });

    } catch (error) {
      this.messagesFailedToSend++;
      this.recordMetrics();

      logger.error('Failed to publish event to Kafka', {
        eventId: event.eventId,
        eventType: event.eventType,
        topic,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Publish multiple events in a batch
   */
  async publishEvents(events: DomainEvent[]): Promise<void> {
    if (!this.producer || !this.isConnected) {
      throw new Error('Kafka Event Bus is not connected');
    }

    if (events.length === 0) {
      return;
    }

    const startTime = Date.now();

    try {
      // Group events by topic
      const eventsByTopic = new Map<string, DomainEvent[]>();

      for (const event of events) {
        const topic = this.getTopicName(event.eventType);
        if (!eventsByTopic.has(topic)) {
          eventsByTopic.set(topic, []);
        }
        eventsByTopic.get(topic)!.push(event);
      }

      // Send to each topic
      const sendPromises = Array.from(eventsByTopic.entries()).map(([topic, topicEvents]) => {
        const messages = topicEvents.map(event => ({
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            correlationId: event.metadata.correlationId || '',
            timestamp: event.timestamp.toISOString(),
            source: event.metadata.source,
            version: event.metadata.version,
          },
          timestamp: event.timestamp.getTime().toString(),
        }));

        return this.producer!.send({ topic, messages });
      });

      await Promise.all(sendPromises);

      // Record success metrics
      this.messagesSent += events.length;
      this.totalSendTime += Date.now() - startTime;
      this.recordMetrics();

      logger.info('Events batch published to Kafka', {
        eventCount: events.length,
        topics: Array.from(eventsByTopic.keys())
      });

    } catch (error) {
      this.messagesFailedToSend += events.length;
      this.recordMetrics();

      logger.error('Failed to publish events batch to Kafka', {
        eventCount: events.length,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Register event processor
   */
  registerProcessor(processor: EventProcessor): void {
    this.processors.set(processor.eventType, processor);

    logger.info('Event processor registered', {
      eventType: processor.eventType,
      processorName: processor.constructor.name
    });
  }

  /**
   * Start consuming events
   */
  async startConsuming(eventTypes?: string[]): Promise<void> {
    if (!this.consumer || !this.isConnected) {
      throw new Error('Kafka Event Bus is not connected');
    }

    const topics = eventTypes
      ? eventTypes.map(type => this.getTopicName(type))
      : Array.from(this.processors.keys()).map(type => this.getTopicName(type));

    if (topics.length === 0) {
      logger.warn('No topics to subscribe to');
      return;
    }

    // Subscribe to topics
    await this.consumer.subscribe({
      topics,
      fromBeginning: false
    });

    // Start consuming
    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(payload);
      },
    });

    logger.info('Started consuming events', {
      topics,
      groupId: this.config.groupId
    });
  }

  /**
   * Stop consuming events
   */
  async stopConsuming(): Promise<void> {
    if (this.consumer) {
      await this.consumer.stop();
      logger.info('Stopped consuming events');
    }
  }

  /**
   * Create Kafka topic
   */
  async createTopic(eventType: string, partitions?: number, replicationFactor?: number): Promise<void> {
    const admin = this.kafka.admin();
    const topic = this.getTopicName(eventType);

    try {
      await admin.connect();

      const topicExists = await admin.listTopics();
      if (topicExists.includes(topic)) {
        logger.debug('Topic already exists', { topic });
        return;
      }

      await admin.createTopics({
        topics: [{
          topic,
          numPartitions: partitions || this.config.topics.defaultPartitions,
          replicationFactor: replicationFactor || this.config.topics.replicationFactor,
          configEntries: Object.entries(this.config.topics.topicConfigs).map(([key, value]) => ({
            name: key,
            value
          }))
        }]
      });

      this.topicsCreated++;
      this.recordMetrics();

      logger.info('Topic created', {
        topic,
        partitions: partitions || this.config.topics.defaultPartitions,
        replicationFactor: replicationFactor || this.config.topics.replicationFactor
      });

    } finally {
      await admin.disconnect();
    }
  }

  /**
   * Get event bus metrics
   */
  getMetrics(): KafkaEventBusMetrics {
    return {
      messagesSent: this.messagesSent,
      messagesFailedToSend: this.messagesFailedToSend,
      avgSendTime: this.messagesSent > 0 ? this.totalSendTime / this.messagesSent : 0,
      messagesReceived: this.messagesReceived,
      messagesProcessed: this.messagesProcessed,
      messagesFailedToProcess: this.messagesFailedToProcess,
      avgProcessingTime: this.messagesProcessed > 0 ? this.totalProcessingTime / this.messagesProcessed : 0,
      connectionErrors: this.connectionErrors,
      reconnections: this.reconnections,
      topicsCreated: this.topicsCreated,
      consumerLag: 0 // TODO: Implement lag calculation
    };
  }

  // Private methods

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const startTime = Date.now();

    this.messagesReceived++;

    try {
      if (!message.value) {
        logger.warn('Received message with no value', { topic, partition, offset: message.offset });
        return;
      }

      // Parse event
      const event: DomainEvent = JSON.parse(message.value.toString());

      // Extract metadata
      const metadata: EventMetadata = {
        topic,
        partition,
        offset: message.offset,
        timestamp: new Date(parseInt(message.timestamp)),
        headers: this.parseHeaders(message.headers),
        key: message.key ? message.key.toString() : null
      };

      // Find processor
      const processor = this.processors.get(event.eventType);
      if (!processor) {
        logger.debug('No processor found for event type', {
          eventType: event.eventType,
          eventId: event.eventId
        });
        return;
      }

      // Process event
      await processor.process(event, metadata);

      this.messagesProcessed++;
      this.totalProcessingTime += Date.now() - startTime;

      logger.debug('Event processed successfully', {
        eventId: event.eventId,
        eventType: event.eventType,
        processingTime: Date.now() - startTime
      });

    } catch (error) {
      this.messagesFailedToProcess++;

      logger.error('Failed to process message', {
        topic,
        partition,
        offset: message.offset,
        error: error instanceof Error ? error.message : String(error)
      });

      // Could implement dead letter queue here
      throw error;

    } finally {
      this.recordMetrics();
    }
  }

  private getTopicName(eventType: string): string {
    return `${this.config.topics.eventTopicPrefix}.${eventType.toLowerCase().replace(/([A-Z])/g, '-$1').substring(1)}`;
  }

  private parseHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {};

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (Buffer.isBuffer(value)) {
          result[key] = value.toString();
        } else if (typeof value === 'string') {
          result[key] = value;
        }
      }
    }

    return result;
  }

  private setupErrorHandlers(): void {
    if (this.producer) {
      this.producer.on('producer.disconnect', () => {
        logger.warn('Producer disconnected');
        this.isConnected = false;
      });

      this.producer.on('producer.connect', () => {
        logger.info('Producer reconnected');
        this.reconnections++;
        this.isConnected = true;
      });
    }

    if (this.consumer) {
      this.consumer.on('consumer.disconnect', () => {
        logger.warn('Consumer disconnected');
        this.isConnected = false;
      });

      this.consumer.on('consumer.connect', () => {
        logger.info('Consumer reconnected');
        this.reconnections++;
        this.isConnected = true;
      });

      this.consumer.on('consumer.crash', (event) => {
        logger.error('Consumer crashed', {
          error: event.payload.error.message,
          groupId: event.payload.groupId
        });
        this.connectionErrors++;
      });
    }
  }

  private recordMetrics(): void {
    if (!this.metrics) return;

    const eventBusMetrics = this.getMetrics();

    this.metrics.recordCustomMetric(
      'kafka_messages_sent_total',
      eventBusMetrics.messagesSent,
      { client_id: this.config.clientId },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'kafka_messages_received_total',
      eventBusMetrics.messagesReceived,
      { client_id: this.config.clientId },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'kafka_messages_processed_total',
      eventBusMetrics.messagesProcessed,
      { client_id: this.config.clientId },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'kafka_connection_errors_total',
      eventBusMetrics.connectionErrors,
      { client_id: this.config.clientId },
      'counter'
    );

    if (eventBusMetrics.avgSendTime > 0) {
      this.metrics.recordCustomMetric(
        'kafka_send_duration_ms',
        eventBusMetrics.avgSendTime,
        { client_id: this.config.clientId },
        'histogram'
      );
    }

    if (eventBusMetrics.avgProcessingTime > 0) {
      this.metrics.recordCustomMetric(
        'kafka_processing_duration_ms',
        eventBusMetrics.avgProcessingTime,
        { client_id: this.config.clientId },
        'histogram'
      );
    }
  }
}