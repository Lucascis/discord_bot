import { EventEmitter } from 'eventemitter3';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Resource Pool Configuration
 */
export interface ResourcePoolConfig {
  /** Pool name identifier */
  name: string;

  /** Maximum number of concurrent operations */
  maxConcurrency: number;

  /** Maximum queue size for waiting operations */
  maxQueueSize: number;

  /** Timeout for queued operations (ms) */
  queueTimeout: number;

  /** Operation timeout (ms) */
  operationTimeout: number;

  /** Pool monitoring configuration */
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    alertThresholds: {
      utilizationPercent: number;
      queueLengthPercent: number;
      avgWaitTimeMs: number;
    };
  };
}

/**
 * Resource Pool Metrics
 */
export interface ResourcePoolMetrics {
  name: string;
  activeOperations: number;
  queuedOperations: number;
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  timedOutOperations: number;
  rejectedOperations: number;
  utilizationPercent: number;
  avgExecutionTime: number;
  avgQueueTime: number;
  maxConcurrencyReached: number;
  maxQueueSizeReached: number;
}

/**
 * Resource Pool Exception
 */
export class ResourcePoolRejectedError extends Error {
  constructor(poolName: string, reason: string) {
    super(`Resource pool '${poolName}' rejected operation: ${reason}`);
    this.name = 'ResourcePoolRejectedError';
  }
}

/**
 * Operation Context
 */
interface OperationContext<T> {
  id: string;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Bulkhead Resource Isolation
 * Implements bulkhead pattern for resource isolation and pool management
 */
export class ResourcePool<T = any> extends EventEmitter {
  private readonly config: ResourcePoolConfig;
  private readonly metrics?: MetricsCollector;

  // Pool state
  private activeOperations = 0;
  private readonly operationQueue: OperationContext<T>[] = [];
  private operationCounter = 0;

  // Metrics tracking
  private totalOperations = 0;
  private completedOperations = 0;
  private failedOperations = 0;
  private timedOutOperations = 0;
  private rejectedOperations = 0;
  private totalExecutionTime = 0;
  private totalQueueTime = 0;
  private maxConcurrencyReached = 0;
  private maxQueueSizeReached = 0;

  // Monitoring
  private monitoringInterval?: NodeJS.Timeout;
  private readonly startTime = Date.now();

  constructor(config: ResourcePoolConfig, metrics?: MetricsCollector) {
    super();
    this.config = config;
    this.metrics = metrics;

    if (config.monitoring.enabled) {
      this.startMonitoring();
    }

    logger.info('Resource pool initialized', {
      name: config.name,
      maxConcurrency: config.maxConcurrency,
      maxQueueSize: config.maxQueueSize,
      monitoring: config.monitoring.enabled
    });
  }

  /**
   * Execute operation with resource pool protection
   */
  async execute(operation: () => Promise<T>): Promise<T> {
    this.totalOperations++;

    // Check if pool is at capacity
    if (this.activeOperations >= this.config.maxConcurrency) {
      // Check if queue is full
      if (this.operationQueue.length >= this.config.maxQueueSize) {
        this.rejectedOperations++;
        this.recordMetrics('rejected');

        throw new ResourcePoolRejectedError(
          this.config.name,
          `Queue is full (${this.operationQueue.length}/${this.config.maxQueueSize})`
        );
      }

      // Queue the operation
      return this.queueOperation(operation);
    }

    // Execute immediately
    return this.executeOperation(operation);
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): ResourcePoolMetrics {
    const utilizationPercent = (this.activeOperations / this.config.maxConcurrency) * 100;

    return {
      name: this.config.name,
      activeOperations: this.activeOperations,
      queuedOperations: this.operationQueue.length,
      totalOperations: this.totalOperations,
      completedOperations: this.completedOperations,
      failedOperations: this.failedOperations,
      timedOutOperations: this.timedOutOperations,
      rejectedOperations: this.rejectedOperations,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      avgExecutionTime: this.getAverageExecutionTime(),
      avgQueueTime: this.getAverageQueueTime(),
      maxConcurrencyReached: this.maxConcurrencyReached,
      maxQueueSizeReached: this.maxQueueSizeReached
    };
  }

  /**
   * Shutdown the resource pool
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down resource pool', {
      name: this.config.name,
      activeOperations: this.activeOperations,
      queuedOperations: this.operationQueue.length
    });

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Reject all queued operations
    while (this.operationQueue.length > 0) {
      const context = this.operationQueue.shift()!;
      if (context.timeoutHandle) {
        clearTimeout(context.timeoutHandle);
      }
      context.reject(new ResourcePoolRejectedError(this.config.name, 'Pool is shutting down'));
    }

    // Wait for active operations to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const shutdownStart = Date.now();

    while (this.activeOperations > 0 && Date.now() - shutdownStart < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.activeOperations > 0) {
      logger.warn('Resource pool shutdown with active operations', {
        name: this.config.name,
        remainingOperations: this.activeOperations
      });
    }

    this.emit('shutdown', { name: this.config.name });
  }

  /**
   * Clear pool statistics
   */
  resetMetrics(): void {
    this.totalOperations = 0;
    this.completedOperations = 0;
    this.failedOperations = 0;
    this.timedOutOperations = 0;
    this.rejectedOperations = 0;
    this.totalExecutionTime = 0;
    this.totalQueueTime = 0;
    this.maxConcurrencyReached = 0;
    this.maxQueueSizeReached = 0;

    logger.info('Resource pool metrics reset', { name: this.config.name });
  }

  // Private methods

  private async queueOperation(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const operationId = `${this.config.name}-${++this.operationCounter}`;
      const queuedAt = Date.now();

      const context: OperationContext<T> = {
        id: operationId,
        operation,
        resolve,
        reject,
        queuedAt
      };

      // Set queue timeout
      context.timeoutHandle = setTimeout(() => {
        // Remove from queue
        const index = this.operationQueue.indexOf(context);
        if (index !== -1) {
          this.operationQueue.splice(index, 1);
          this.timedOutOperations++;
          this.recordMetrics('timeout');

          reject(new ResourcePoolRejectedError(
            this.config.name,
            `Operation timed out in queue after ${this.config.queueTimeout}ms`
          ));
        }
      }, this.config.queueTimeout);

      this.operationQueue.push(context);

      // Update max queue size reached
      if (this.operationQueue.length > this.maxQueueSizeReached) {
        this.maxQueueSizeReached = this.operationQueue.length;
      }

      this.recordMetrics('queued');

      logger.debug('Operation queued', {
        poolName: this.config.name,
        operationId,
        queueLength: this.operationQueue.length,
        activeOperations: this.activeOperations
      });
    });
  }

  private async executeOperation(operation: () => Promise<T>): Promise<T> {
    this.activeOperations++;

    // Update max concurrency reached
    if (this.activeOperations > this.maxConcurrencyReached) {
      this.maxConcurrencyReached = this.activeOperations;
    }

    const startTime = Date.now();

    try {
      // Apply operation timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout')), this.config.operationTimeout);
      });

      const result = await Promise.race([operation(), timeoutPromise]);
      const executionTime = Date.now() - startTime;

      // Record success
      this.completedOperations++;
      this.totalExecutionTime += executionTime;
      this.recordMetrics('success', executionTime);

      logger.debug('Operation completed successfully', {
        poolName: this.config.name,
        executionTime,
        activeOperations: this.activeOperations - 1
      });

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;

      if (error instanceof Error && error.message === 'Operation timeout') {
        this.timedOutOperations++;
        this.recordMetrics('timeout', executionTime);
      } else {
        this.failedOperations++;
        this.recordMetrics('failure', executionTime);
      }

      this.totalExecutionTime += executionTime;

      logger.warn('Operation failed', {
        poolName: this.config.name,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
        activeOperations: this.activeOperations - 1
      });

      throw error;

    } finally {
      this.activeOperations--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    // Process next operation in queue if pool has capacity
    if (this.activeOperations < this.config.maxConcurrency && this.operationQueue.length > 0) {
      const context = this.operationQueue.shift()!;

      // Clear queue timeout
      if (context.timeoutHandle) {
        clearTimeout(context.timeoutHandle);
      }

      // Record queue time
      const queueTime = Date.now() - context.queuedAt;
      this.totalQueueTime += queueTime;

      logger.debug('Processing queued operation', {
        poolName: this.config.name,
        operationId: context.id,
        queueTime,
        remainingQueue: this.operationQueue.length
      });

      // Execute the operation
      this.executeOperation(context.operation)
        .then(context.resolve)
        .catch(context.reject);
    }
  }

  private getAverageExecutionTime(): number {
    const totalCompleted = this.completedOperations + this.failedOperations + this.timedOutOperations;
    return totalCompleted > 0 ? Math.round(this.totalExecutionTime / totalCompleted) : 0;
  }

  private getAverageQueueTime(): number {
    return this.completedOperations > 0 ? Math.round(this.totalQueueTime / this.completedOperations) : 0;
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const metrics = this.getMetrics();
      const { alertThresholds } = this.config.monitoring;

      // Check alert thresholds
      if (metrics.utilizationPercent >= alertThresholds.utilizationPercent) {
        this.emit('alert', {
          type: 'high_utilization',
          poolName: this.config.name,
          value: metrics.utilizationPercent,
          threshold: alertThresholds.utilizationPercent
        });
      }

      const queueUtilization = (metrics.queuedOperations / this.config.maxQueueSize) * 100;
      if (queueUtilization >= alertThresholds.queueLengthPercent) {
        this.emit('alert', {
          type: 'high_queue_length',
          poolName: this.config.name,
          value: queueUtilization,
          threshold: alertThresholds.queueLengthPercent
        });
      }

      if (metrics.avgQueueTime >= alertThresholds.avgWaitTimeMs) {
        this.emit('alert', {
          type: 'high_wait_time',
          poolName: this.config.name,
          value: metrics.avgQueueTime,
          threshold: alertThresholds.avgWaitTimeMs
        });
      }

      // Emit metrics for monitoring
      this.emit('metrics', metrics);

    }, this.config.monitoring.metricsInterval);
  }

  private recordMetrics(type: 'success' | 'failure' | 'timeout' | 'rejected' | 'queued', duration?: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'resource_pool_operations_total',
      1,
      {
        pool_name: this.config.name,
        type
      },
      'counter'
    );

    if (duration !== undefined) {
      this.metrics.recordCustomMetric(
        'resource_pool_operation_duration_ms',
        duration,
        {
          pool_name: this.config.name,
          type
        },
        'histogram'
      );
    }

    this.metrics.recordCustomMetric(
      'resource_pool_active_operations',
      this.activeOperations,
      {
        pool_name: this.config.name
      },
      'gauge'
    );

    this.metrics.recordCustomMetric(
      'resource_pool_queued_operations',
      this.operationQueue.length,
      {
        pool_name: this.config.name
      },
      'gauge'
    );
  }
}