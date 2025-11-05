import { metrics } from '@opentelemetry/api';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { logger } from '@discord-bot/logger';

/**
 * Custom Metrics Collector
 * Collects application-specific metrics
 */
export class MetricsCollector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private meter: any;

  // OpenTelemetry metrics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private commandCounter: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private commandDuration: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeSessionsGauge: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queueSizeHistogram: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private errorCounter: any;

  // Prometheus metrics
  private promCommandCounter!: Counter<string>;
  private promCommandDuration!: Histogram<string>;
  private promActiveSessionsGauge!: Gauge<string>;
  private promQueueSizeGauge!: Gauge<string>;
  private promErrorCounter!: Counter<string>;
  private promEventStoreEvents!: Counter<string>;
  private promSagaCounter!: Counter<string>;

  constructor(serviceName: string, serviceVersion: string) {
    // Initialize OpenTelemetry meter
    this.meter = metrics.getMeter(serviceName, serviceVersion);

    // Initialize OpenTelemetry metrics
    this.initializeOTelMetrics();

    // Initialize Prometheus metrics
    this.initializePrometheusMetrics();

    // Collect default Node.js metrics
    collectDefaultMetrics({
      register,
      prefix: 'discord_bot_',
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
    });

    logger.info('Metrics collector initialized', {
      serviceName,
      serviceVersion
    });
  }

  /**
   * Initialize OpenTelemetry metrics
   */
  private initializeOTelMetrics(): void {
    this.commandCounter = this.meter.createCounter('discord_commands_total', {
      description: 'Total number of Discord commands executed',
    });

    this.commandDuration = this.meter.createHistogram('discord_command_duration_seconds', {
      description: 'Duration of Discord command execution',
      unit: 's',
    });

    this.activeSessionsGauge = this.meter.createUpDownCounter('discord_active_sessions', {
      description: 'Number of active music sessions',
    });

    this.queueSizeHistogram = this.meter.createHistogram('discord_queue_size', {
      description: 'Distribution of queue sizes',
    });

    this.errorCounter = this.meter.createCounter('discord_errors_total', {
      description: 'Total number of errors',
    });
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializePrometheusMetrics(): void {
    this.promCommandCounter = new Counter({
      name: 'discord_bot_commands_total',
      help: 'Total number of Discord commands executed',
      labelNames: ['command_name', 'guild_id', 'status', 'user_id'],
      registers: [register]
    });

    this.promCommandDuration = new Histogram({
      name: 'discord_bot_command_duration_seconds',
      help: 'Duration of Discord command execution in seconds',
      labelNames: ['command_name', 'guild_id', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [register]
    });

    this.promActiveSessionsGauge = new Gauge({
      name: 'discord_bot_active_sessions',
      help: 'Number of active music sessions',
      labelNames: ['guild_id'],
      registers: [register]
    });

    this.promQueueSizeGauge = new Gauge({
      name: 'discord_bot_queue_size',
      help: 'Current queue size per guild',
      labelNames: ['guild_id'],
      registers: [register]
    });

    this.promErrorCounter = new Counter({
      name: 'discord_bot_errors_total',
      help: 'Total number of errors by type',
      labelNames: ['error_type', 'service', 'guild_id'],
      registers: [register]
    });

    this.promEventStoreEvents = new Counter({
      name: 'discord_bot_eventstore_events_total',
      help: 'Total number of events stored',
      labelNames: ['event_type', 'aggregate_type'],
      registers: [register]
    });

    this.promSagaCounter = new Counter({
      name: 'discord_bot_sagas_total',
      help: 'Total number of sagas by status',
      labelNames: ['saga_type', 'status'],
      registers: [register]
    });
  }

  /**
   * Record command execution
   */
  recordCommand(
    commandName: string,
    guildId: string,
    userId: string,
    status: 'success' | 'error' | 'timeout',
    duration: number
  ): void {
    // OpenTelemetry
    this.commandCounter.add(1, {
      command_name: commandName,
      guild_id: guildId,
      status,
    });

    this.commandDuration.record(duration / 1000, {
      command_name: commandName,
      guild_id: guildId,
      status,
    });

    // Prometheus
    this.promCommandCounter
      .labels(commandName, guildId, status, userId)
      .inc();

    this.promCommandDuration
      .labels(commandName, guildId, status)
      .observe(duration / 1000);
  }

  /**
   * Update active sessions count
   */
  updateActiveSessions(guildId: string, count: number): void {
    this.promActiveSessionsGauge
      .labels(guildId)
      .set(count);
  }

  /**
   * Update queue size
   */
  updateQueueSize(guildId: string, size: number): void {
    this.queueSizeHistogram.record(size, {
      guild_id: guildId,
    });

    this.promQueueSizeGauge
      .labels(guildId)
      .set(size);
  }

  /**
   * Record error
   */
  recordError(
    errorType: string,
    service: string,
    guildId?: string
  ): void {
    this.errorCounter.add(1, {
      error_type: errorType,
      service,
      guild_id: guildId || 'unknown',
    });

    this.promErrorCounter
      .labels(errorType, service, guildId || 'unknown')
      .inc();
  }

  /**
   * Record event store event
   */
  recordEventStoreEvent(eventType: string, aggregateType: string): void {
    this.promEventStoreEvents
      .labels(eventType, aggregateType)
      .inc();
  }

  /**
   * Record saga execution
   */
  recordSaga(sagaType: string, status: 'started' | 'completed' | 'failed' | 'compensated'): void {
    this.promSagaCounter
      .labels(sagaType, status)
      .inc();
  }

  /**
   * Record custom metric
   */
  recordCustomMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    type: 'counter' | 'gauge' | 'histogram' = 'counter'
  ): void {
    try {
      switch (type) {
        case 'counter': {
          const counter = this.meter.createCounter(name);
          counter.add(value, labels);
          break;
        }

        case 'gauge': {
          const gauge = this.meter.createUpDownCounter(name);
          gauge.add(value, labels);
          break;
        }

        case 'histogram': {
          const histogram = this.meter.createHistogram(name);
          histogram.record(value, labels);
          break;
        }
      }
    } catch (error) {
      logger.error('Failed to record custom metric', {
        name,
        value,
        labels,
        type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Get metrics for specific labels
   */
  getMetricsByGuild(guildId: string): Record<string, any> {
    const activeSessionsMetric = this.promActiveSessionsGauge.labels(guildId);
    const queueSizeMetric = this.promQueueSizeGauge.labels(guildId);
// eslint-disable-next-line @typescript-eslint/no-explicit-any

    return {
      activeSessions: activeSessionsMetric,
      queueSize: queueSizeMetric,
    };
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    register.clear();
    this.initializePrometheusMetrics();

    // Re-enable default metrics
    collectDefaultMetrics({
      register,
      prefix: 'discord_bot_',
    });
  }

  /**
   * Create health check metrics
   */
  createHealthMetrics(): {
    healthy: Gauge<string>;
    uptime: Gauge<string>;
    memoryUsage: Gauge<string>;
  } {
    const healthy = new Gauge({
      name: 'discord_bot_healthy',
      help: 'Health status of the service (1 = healthy, 0 = unhealthy)',
      labelNames: ['service'],
      registers: [register]
    });

    const uptime = new Gauge({
      name: 'discord_bot_uptime_seconds',
      help: 'Uptime of the service in seconds',
      labelNames: ['service'],
      registers: [register]
    });

    const memoryUsage = new Gauge({
      name: 'discord_bot_memory_usage_bytes',
      help: 'Memory usage of the service in bytes',
      labelNames: ['service', 'type'],
      registers: [register]
    });

    return { healthy, uptime, memoryUsage };
  }
}