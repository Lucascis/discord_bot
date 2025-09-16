import { EventEmitter } from 'events';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import type { DomainEvent } from '@discord-bot/event-store';

/**
 * Stream Processing Window Types
 */
export type WindowType = 'tumbling' | 'sliding' | 'session';

/**
 * Window Configuration
 */
export interface WindowConfig {
  type: WindowType;
  sizeMs: number;
  slideMs?: number; // For sliding windows
  idleTimeoutMs?: number; // For session windows
  graceMs?: number; // Grace period for late arrivals
}

/**
 * Stream Aggregation Function
 */
export interface StreamAggregator<T, R> {
  initialize(): R;
  aggregate(accumulator: R, event: T): R;
  merge?(acc1: R, acc2: R): R;
}

/**
 * Stream Filter Function
 */
export type StreamFilter<T> = (event: T) => boolean;

/**
 * Stream Transformation Function
 */
export type StreamTransformer<T, R> = (event: T) => R | Promise<R>;

/**
 * Stream Join Configuration
 */
export interface JoinConfig {
  windowMs: number;
  joinKey: (event: DomainEvent) => string;
  joinType: 'inner' | 'left' | 'outer';
}

/**
 * Stream Processing Pipeline
 */
export interface StreamPipeline<T, R> {
  name: string;
  source: string;
  filters?: StreamFilter<T>[];
  transformers?: StreamTransformer<T, any>[];
  aggregator?: StreamAggregator<T, R>;
  window?: WindowConfig;
  sink: StreamSink<R>;
}

/**
 * Stream Sink Interface
 */
export interface StreamSink<T> {
  name: string;
  write(data: T, metadata: StreamMetadata): Promise<void>;
}

/**
 * Stream Metadata
 */
export interface StreamMetadata {
  timestamp: Date;
  windowStart?: Date;
  windowEnd?: Date;
  eventCount: number;
  processingLatency: number;
  watermark: Date;
}

/**
 * Stream Processing Metrics
 */
export interface StreamMetrics {
  eventsProcessed: number;
  eventsFiltered: number;
  eventsTransformed: number;
  eventsAggregated: number;
  eventsSinked: number;
  avgProcessingLatency: number;
  windowsCreated: number;
  windowsCompleted: number;
  errorsTotal: number;
  throughputPerSecond: number;
}

/**
 * Window State
 */
interface WindowState<T, R> {
  windowStart: Date;
  windowEnd: Date;
  events: T[];
  accumulator?: R;
  lastSeen: Date;
  isComplete: boolean;
}

/**
 * Event Stream Processor
 * Real-time stream processing with windowing and aggregations
 */
export class EventStreamProcessor<T = DomainEvent, R = any> extends EventEmitter {
  private readonly pipeline: StreamPipeline<T, R>;
  private readonly metrics?: MetricsCollector;

  // Stream state
  private readonly windows = new Map<string, WindowState<T, R>>();
  private watermark = new Date(0);
  private isRunning = false;

  // Metrics tracking
  private eventsProcessed = 0;
  private eventsFiltered = 0;
  private eventsTransformed = 0;
  private eventsAggregated = 0;
  private eventsSinked = 0;
  private totalProcessingLatency = 0;
  private windowsCreated = 0;
  private windowsCompleted = 0;
  private errorsTotal = 0;
  private readonly startTime = Date.now();

  // Timers
  private watermarkTimer?: NodeJS.Timeout;
  private windowCleanupTimer?: NodeJS.Timeout;

  constructor(pipeline: StreamPipeline<T, R>, metrics?: MetricsCollector) {
    super();
    this.pipeline = pipeline;
    this.metrics = metrics;

    logger.info('Stream processor initialized', {
      pipelineName: pipeline.name,
      source: pipeline.source,
      hasWindow: !!pipeline.window,
      hasAggregator: !!pipeline.aggregator
    });
  }

  /**
   * Start stream processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Stream processor is already running', {
        pipelineName: this.pipeline.name
      });
      return;
    }

    this.isRunning = true;

    // Start watermark advancement
    this.startWatermarkAdvancement();

    // Start window cleanup
    this.startWindowCleanup();

    this.emit('started', { pipelineName: this.pipeline.name });

    logger.info('Stream processor started', {
      pipelineName: this.pipeline.name
    });
  }

  /**
   * Stop stream processing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop timers
    if (this.watermarkTimer) {
      clearInterval(this.watermarkTimer);
    }

    if (this.windowCleanupTimer) {
      clearInterval(this.windowCleanupTimer);
    }

    // Complete all open windows
    await this.completeAllWindows();

    this.emit('stopped', { pipelineName: this.pipeline.name });

    logger.info('Stream processor stopped', {
      pipelineName: this.pipeline.name
    });
  }

  /**
   * Process an event through the stream pipeline
   */
  async processEvent(event: T): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const startTime = Date.now();
    this.eventsProcessed++;

    try {
      // Update watermark
      const eventTime = this.extractEventTime(event);
      this.updateWatermark(eventTime);

      // Apply filters
      if (this.pipeline.filters) {
        for (const filter of this.pipeline.filters) {
          if (!filter(event)) {
            this.eventsFiltered++;
            this.recordMetrics();
            return;
          }
        }
      }

      // Apply transformations
      let transformedEvent: any = event;
      if (this.pipeline.transformers) {
        for (const transformer of this.pipeline.transformers) {
          transformedEvent = await transformer(transformedEvent);
          this.eventsTransformed++;
        }
      }

      // Process with window if configured
      if (this.pipeline.window) {
        await this.processWithWindow(transformedEvent as T, eventTime);
      } else {
        // Direct processing without windowing
        await this.processWithoutWindow(transformedEvent as R);
      }

      // Record processing latency
      this.totalProcessingLatency += Date.now() - startTime;
      this.recordMetrics();

    } catch (error) {
      this.errorsTotal++;
      this.recordMetrics();

      logger.error('Error processing event in stream', {
        pipelineName: this.pipeline.name,
        error: error instanceof Error ? error.message : String(error),
        eventType: (event as any).eventType || 'unknown'
      });

      this.emit('error', {
        pipelineName: this.pipeline.name,
        error,
        event
      });

      throw error;
    }
  }

  /**
   * Process multiple events in batch
   */
  async processBatch(events: T[]): Promise<void> {
    if (!this.isRunning || events.length === 0) {
      return;
    }

    const batchStartTime = Date.now();

    logger.debug('Processing event batch', {
      pipelineName: this.pipeline.name,
      batchSize: events.length
    });

    // Process events in parallel (up to a limit)
    const concurrencyLimit = 10;
    const batches: T[][] = [];

    for (let i = 0; i < events.length; i += concurrencyLimit) {
      batches.push(events.slice(i, i + concurrencyLimit));
    }

    for (const batch of batches) {
      await Promise.all(batch.map(event => this.processEvent(event)));
    }

    const batchProcessingTime = Date.now() - batchStartTime;

    logger.info('Event batch processed', {
      pipelineName: this.pipeline.name,
      batchSize: events.length,
      processingTimeMs: batchProcessingTime,
      throughput: Math.round((events.length / batchProcessingTime) * 1000)
    });
  }

  /**
   * Get stream processing metrics
   */
  getMetrics(): StreamMetrics {
    const uptime = Date.now() - this.startTime;
    const throughputPerSecond = uptime > 0 ? (this.eventsProcessed / uptime) * 1000 : 0;

    return {
      eventsProcessed: this.eventsProcessed,
      eventsFiltered: this.eventsFiltered,
      eventsTransformed: this.eventsTransformed,
      eventsAggregated: this.eventsAggregated,
      eventsSinked: this.eventsSinked,
      avgProcessingLatency: this.eventsProcessed > 0 ? this.totalProcessingLatency / this.eventsProcessed : 0,
      windowsCreated: this.windowsCreated,
      windowsCompleted: this.windowsCompleted,
      errorsTotal: this.errorsTotal,
      throughputPerSecond: Math.round(throughputPerSecond * 100) / 100
    };
  }

  /**
   * Get current watermark
   */
  getWatermark(): Date {
    return this.watermark;
  }

  /**
   * Get active windows count
   */
  getActiveWindowsCount(): number {
    return this.windows.size;
  }

  // Private methods

  private async processWithWindow(event: T, eventTime: Date): Promise<void> {
    const windowConfig = this.pipeline.window!;
    const windowKey = this.calculateWindowKey(eventTime, windowConfig);

    // Get or create window
    let window = this.windows.get(windowKey);
    if (!window) {
      const { windowStart, windowEnd } = this.calculateWindowBounds(eventTime, windowConfig);

      window = {
        windowStart,
        windowEnd,
        events: [],
        lastSeen: eventTime,
        isComplete: false
      };

      if (this.pipeline.aggregator) {
        window.accumulator = this.pipeline.aggregator.initialize();
      }

      this.windows.set(windowKey, window);
      this.windowsCreated++;

      logger.debug('Created new window', {
        pipelineName: this.pipeline.name,
        windowKey,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd
      });
    }

    // Add event to window
    window.events.push(event);
    window.lastSeen = eventTime;

    // Update aggregation
    if (this.pipeline.aggregator && window.accumulator !== undefined) {
      window.accumulator = this.pipeline.aggregator.aggregate(window.accumulator, event);
      this.eventsAggregated++;
    }

    // Check if window should be completed
    if (this.shouldCompleteWindow(window, windowConfig)) {
      await this.completeWindow(windowKey, window);
    }
  }

  private async processWithoutWindow(result: R): Promise<void> {
    const metadata: StreamMetadata = {
      timestamp: new Date(),
      eventCount: 1,
      processingLatency: 0,
      watermark: this.watermark
    };

    await this.pipeline.sink.write(result, metadata);
    this.eventsSinked++;
  }

  private async completeWindow(windowKey: string, window: WindowState<T, R>): Promise<void> {
    if (window.isComplete) {
      return;
    }

    window.isComplete = true;

    try {
      // Determine result to sink
      let result: R;
      if (this.pipeline.aggregator && window.accumulator !== undefined) {
        result = window.accumulator;
      } else {
        result = window.events as any; // Fallback to raw events
      }

      // Create metadata
      const metadata: StreamMetadata = {
        timestamp: new Date(),
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        eventCount: window.events.length,
        processingLatency: Date.now() - window.windowStart.getTime(),
        watermark: this.watermark
      };

      // Write to sink
      await this.pipeline.sink.write(result, metadata);

      this.eventsSinked++;
      this.windowsCompleted++;

      logger.debug('Window completed', {
        pipelineName: this.pipeline.name,
        windowKey,
        eventCount: window.events.length,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd
      });

      this.emit('window_completed', {
        pipelineName: this.pipeline.name,
        windowKey,
        eventCount: window.events.length,
        result,
        metadata
      });

    } catch (error) {
      logger.error('Error completing window', {
        pipelineName: this.pipeline.name,
        windowKey,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;

    } finally {
      // Remove window
      this.windows.delete(windowKey);
    }
  }

  private calculateWindowKey(eventTime: Date, config: WindowConfig): string {
    const timestamp = eventTime.getTime();

    switch (config.type) {
      case 'tumbling':
        const windowStart = Math.floor(timestamp / config.sizeMs) * config.sizeMs;
        return `tumbling-${windowStart}`;

      case 'sliding':
        const slideMs = config.slideMs || config.sizeMs;
        const slideStart = Math.floor(timestamp / slideMs) * slideMs;
        return `sliding-${slideStart}`;

      case 'session':
        // For session windows, use a different approach
        return `session-${timestamp}`;

      default:
        throw new Error(`Unsupported window type: ${config.type}`);
    }
  }

  private calculateWindowBounds(eventTime: Date, config: WindowConfig): { windowStart: Date; windowEnd: Date } {
    const timestamp = eventTime.getTime();

    switch (config.type) {
      case 'tumbling':
        const tumblingStart = Math.floor(timestamp / config.sizeMs) * config.sizeMs;
        return {
          windowStart: new Date(tumblingStart),
          windowEnd: new Date(tumblingStart + config.sizeMs)
        };

      case 'sliding':
        const slideMs = config.slideMs || config.sizeMs;
        const slidingStart = Math.floor(timestamp / slideMs) * slideMs;
        return {
          windowStart: new Date(slidingStart),
          windowEnd: new Date(slidingStart + config.sizeMs)
        };

      case 'session':
        return {
          windowStart: new Date(timestamp),
          windowEnd: new Date(timestamp + (config.idleTimeoutMs || 300000)) // 5 min default
        };

      default:
        throw new Error(`Unsupported window type: ${config.type}`);
    }
  }

  private shouldCompleteWindow(window: WindowState<T, R>, config: WindowConfig): boolean {
    const now = Date.now();

    // Check if window end time has passed (with grace period)
    const graceMs = config.graceMs || 0;
    if (now >= window.windowEnd.getTime() + graceMs) {
      return true;
    }

    // For session windows, check idle timeout
    if (config.type === 'session') {
      const idleTimeoutMs = config.idleTimeoutMs || 300000;
      if (now >= window.lastSeen.getTime() + idleTimeoutMs) {
        return true;
      }
    }

    return false;
  }

  private extractEventTime(event: T): Date {
    // Try to extract timestamp from event
    if ((event as any).timestamp instanceof Date) {
      return (event as any).timestamp;
    }

    if (typeof (event as any).timestamp === 'string') {
      return new Date((event as any).timestamp);
    }

    if (typeof (event as any).timestamp === 'number') {
      return new Date((event as any).timestamp);
    }

    // Fallback to current time
    return new Date();
  }

  private updateWatermark(eventTime: Date): void {
    if (eventTime > this.watermark) {
      this.watermark = eventTime;
    }
  }

  private startWatermarkAdvancement(): void {
    this.watermarkTimer = setInterval(() => {
      // Advance watermark to current time
      const now = new Date();
      if (now > this.watermark) {
        this.watermark = now;
      }

      this.emit('watermark_advanced', {
        pipelineName: this.pipeline.name,
        watermark: this.watermark
      });

    }, 1000); // Advance every second
  }

  private startWindowCleanup(): void {
    this.windowCleanupTimer = setInterval(async () => {
      if (!this.pipeline.window) {
        return;
      }

      const windowsToComplete: Array<[string, WindowState<T, R>]> = [];
      const now = Date.now();

      for (const [key, window] of this.windows.entries()) {
        if (this.shouldCompleteWindow(window, this.pipeline.window)) {
          windowsToComplete.push([key, window]);
        }
      }

      // Complete windows
      for (const [key, window] of windowsToComplete) {
        try {
          await this.completeWindow(key, window);
        } catch (error) {
          logger.error('Error during window cleanup', {
            pipelineName: this.pipeline.name,
            windowKey: key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (windowsToComplete.length > 0) {
        logger.debug('Window cleanup completed', {
          pipelineName: this.pipeline.name,
          windowsCompleted: windowsToComplete.length
        });
      }

    }, 5000); // Check every 5 seconds
  }

  private async completeAllWindows(): Promise<void> {
    const windowsToComplete = Array.from(this.windows.entries());

    for (const [key, window] of windowsToComplete) {
      try {
        await this.completeWindow(key, window);
      } catch (error) {
        logger.error('Error completing window during shutdown', {
          pipelineName: this.pipeline.name,
          windowKey: key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('All windows completed during shutdown', {
      pipelineName: this.pipeline.name,
      windowsCompleted: windowsToComplete.length
    });
  }

  private recordMetrics(): void {
    if (!this.metrics) return;

    const metrics = this.getMetrics();

    this.metrics.recordCustomMetric(
      'stream_events_processed_total',
      metrics.eventsProcessed,
      { pipeline: this.pipeline.name },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'stream_events_sinked_total',
      metrics.eventsSinked,
      { pipeline: this.pipeline.name },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'stream_processing_latency_ms',
      metrics.avgProcessingLatency,
      { pipeline: this.pipeline.name },
      'histogram'
    );

    this.metrics.recordCustomMetric(
      'stream_throughput_per_second',
      metrics.throughputPerSecond,
      { pipeline: this.pipeline.name },
      'gauge'
    );

    this.metrics.recordCustomMetric(
      'stream_active_windows',
      this.windows.size,
      { pipeline: this.pipeline.name },
      'gauge'
    );
  }
}