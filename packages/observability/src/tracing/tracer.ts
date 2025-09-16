import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { trace, metrics, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { logger } from '@discord-bot/logger';

/**
 * OpenTelemetry Configuration
 */
export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  jaeger?: {
    endpoint: string;
    enabled: boolean;
  };
  prometheus?: {
    port: number;
    endpoint: string;
    enabled: boolean;
  };
  sampling: {
    ratio: number; // 0.0 to 1.0
  };
}

/**
 * Telemetry Manager
 * Configures and manages OpenTelemetry instrumentation
 */
export class TelemetryManager {
  private sdk?: NodeSDK;
  private tracer: any;
  private meter: any;
  private config: TelemetryConfig;

  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  /**
   * Initialize OpenTelemetry
   */
  async initialize(): Promise<void> {
    try {
      const exporters = [];

      // Configure Jaeger exporter for distributed tracing
      if (this.config.jaeger?.enabled) {
        exporters.push(
          new JaegerExporter({
            endpoint: this.config.jaeger.endpoint,
          })
        );
      }

      // Configure Prometheus exporter for metrics
      if (this.config.prometheus?.enabled) {
        const prometheusExporter = new PrometheusExporter({
          port: this.config.prometheus.port,
          endpoint: this.config.prometheus.endpoint,
        });
        exporters.push(prometheusExporter);
      }

      // Initialize SDK
      this.sdk = new NodeSDK({
        serviceName: this.config.serviceName,
        serviceVersion: this.config.serviceVersion,
        traceExporter: exporters.length > 0 ? exporters[0] : undefined,
        metricReader: exporters.length > 1 ? exporters[1] : undefined,
        instrumentations: [getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable file system instrumentation to reduce noise
          },
        })],
      });

      await this.sdk.start();

      // Get tracer and meter instances
      this.tracer = trace.getTracer(this.config.serviceName, this.config.serviceVersion);
      this.meter = metrics.getMeter(this.config.serviceName, this.config.serviceVersion);

      logger.info('OpenTelemetry initialized successfully', {
        serviceName: this.config.serviceName,
        serviceVersion: this.config.serviceVersion,
        environment: this.config.environment,
        jaegerEnabled: this.config.jaeger?.enabled,
        prometheusEnabled: this.config.prometheus?.enabled
      });

    } catch (error) {
      logger.error('Failed to initialize OpenTelemetry', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Shutdown OpenTelemetry
   */
  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
      logger.info('OpenTelemetry shutdown completed');
    }
  }

  /**
   * Get tracer instance
   */
  getTracer(): any {
    return this.tracer;
  }

  /**
   * Get meter instance
   */
  getMeter(): any {
    return this.meter;
  }

  /**
   * Create a new span with automatic error handling
   */
  async withSpan<T>(
    name: string,
    operation: (span: any) => Promise<T>,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, string | number | boolean>;
      parent?: any;
    } = {}
  ): Promise<T> {
    const span = this.tracer.startSpan(name, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes,
      parent: options.parent,
    });

    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;

    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      span.recordException(error as Error);
      throw error;

    } finally {
      span.end();
    }
  }

  /**
   * Create span for Discord command execution
   */
  async withCommandSpan<T>(
    commandName: string,
    guildId: string,
    userId: string,
    operation: (span: any) => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `discord.command.${commandName}`,
      operation,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [SemanticAttributes.USER_ID]: userId,
          'discord.guild.id': guildId,
          'discord.command.name': commandName,
          'service.name': this.config.serviceName,
        },
      }
    );
  }

  /**
   * Create span for database operations
   */
  async withDatabaseSpan<T>(
    operation: string,
    table: string,
    dbOperation: (span: any) => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `db.${operation}`,
      dbOperation,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          [SemanticAttributes.DB_OPERATION]: operation,
          [SemanticAttributes.DB_SQL_TABLE]: table,
          [SemanticAttributes.DB_SYSTEM]: 'postgresql',
        },
      }
    );
  }

  /**
   * Create span for external service calls
   */
  async withExternalServiceSpan<T>(
    serviceName: string,
    operation: string,
    serviceOperation: (span: any) => Promise<T>
  ): Promise<T> {
    return this.withSpan(
      `external.${serviceName}.${operation}`,
      serviceOperation,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'service.name': serviceName,
          'service.operation': operation,
        },
      }
    );
  }

  /**
   * Add event to current span
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  /**
   * Set attributes on current span
   */
  setAttributes(attributes: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }

  /**
   * Record an exception in current span
   */
  recordException(error: Error): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    }
  }
}