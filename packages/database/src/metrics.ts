import { Counter, Histogram, register } from 'prom-client';
import { logger } from '@discord-bot/logger';
import type { PrismaClient } from '@prisma/client';

// Database performance metrics
export const dbQueryCounter = new Counter({
  name: 'database_queries_total',
  help: 'Total number of database queries executed',
  labelNames: ['operation', 'model', 'success'],
  registers: [register]
});

export const dbQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'model'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const dbConnectionPoolGauge = new Counter({
  name: 'database_connection_pool_events_total',
  help: 'Database connection pool events',
  labelNames: ['event_type'], // 'acquired', 'released', 'timeout', 'error'
  registers: [register]
});

export const dbSlowQueryCounter = new Counter({
  name: 'database_slow_queries_total',
  help: 'Number of slow database queries (>100ms)',
  labelNames: ['operation', 'model', 'threshold'],
  registers: [register]
});

export const dbTransactionCounter = new Counter({
  name: 'database_transactions_total',
  help: 'Number of database transactions',
  labelNames: ['status'], // 'committed', 'aborted', 'failed'
  registers: [register]
});

export const dbTransactionDuration = new Histogram({
  name: 'database_transaction_duration_seconds',
  help: 'Duration of database transactions in seconds',
  labelNames: ['status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register]
});

// Business-specific database metrics
export const queueOperationsCounter = new Counter({
  name: 'queue_operations_total',
  help: 'Queue database operations',
  labelNames: ['operation'], // 'rebuild', 'incremental_add', 'incremental_remove', 'clear'
  registers: [register]
});

export const queueOptimizationGauge = new Counter({
  name: 'queue_optimization_savings_total',
  help: 'Number of database operations saved by incremental updates',
  labelNames: ['optimization_type'], // 'skipped_rebuild', 'incremental_update'
  registers: [register]
});

/**
 * Enhanced query instrumentation for detailed performance tracking
 */
export function instrumentQuery<T>(
  operation: string,
  model: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const timer = dbQueryDuration.startTimer({ operation, model });

  return queryFn()
    .then(result => {
      const duration = Date.now() - startTime;
      timer();

      // Record successful query
      dbQueryCounter.labels(operation, model, 'true').inc();

      // Track slow queries
      if (duration > 100) {
        dbSlowQueryCounter.labels(operation, model, '100ms').inc();
        logger.warn({
          operation,
          model,
          duration,
          slowQueryThreshold: '100ms'
        }, 'Slow database query detected');
      }

      if (duration > 500) {
        dbSlowQueryCounter.labels(operation, model, '500ms').inc();
        logger.error({
          operation,
          model,
          duration,
          slowQueryThreshold: '500ms'
        }, 'Very slow database query - requires immediate optimization');
      }

      return result;
    })
    .catch(error => {
      timer();
      dbQueryCounter.labels(operation, model, 'false').inc();

      logger.error({
        operation,
        model,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }, 'Database query failed');

      throw error;
    });
}

/**
 * Creates a Prisma middleware for automatic query instrumentation
 */
export function createQueryInstrumentationMiddleware(prisma: PrismaClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$use(async (params: any, next: any) => {
    const startTime = Date.now();
    const timer = dbQueryDuration.startTimer({
      operation: params.action,
      model: params.model || 'unknown'
    });

    try {
      const result = await next(params);
      const duration = Date.now() - startTime;
      timer();

      // Record successful query
      dbQueryCounter.labels(
        params.action,
        params.model || 'unknown',
        'true'
      ).inc();

      // Track slow queries
      if (duration > 100) {
        dbSlowQueryCounter.labels(
          params.action,
          params.model || 'unknown',
          '100ms'
        ).inc();

        logger.warn({
          operation: params.action,
          model: params.model,
          duration,
          slowQueryThreshold: '100ms'
        }, 'Slow database query detected');
      }

      if (duration > 500) {
        dbSlowQueryCounter.labels(
          params.action,
          params.model || 'unknown',
          '500ms'
        ).inc();

        logger.error({
          operation: params.action,
          model: params.model,
          duration,
          slowQueryThreshold: '500ms'
        }, 'Very slow database query - requires immediate optimization');
      }

      return result;
    } catch (error) {
      timer();
      dbQueryCounter.labels(
        params.action,
        params.model || 'unknown',
        'false'
      ).inc();

      logger.error({
        operation: params.action,
        model: params.model,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }, 'Database query failed');

      throw error;
    }
  });
}

/**
 * Transaction instrumentation
 */
export function instrumentTransaction<T>(
  transactionFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  const timer = dbTransactionDuration.startTimer({ status: 'pending' });

  return transactionFn()
    .then(result => {
      const duration = (Date.now() - startTime) / 1000;
      timer({ status: 'committed' });
      dbTransactionCounter.labels('committed').inc();

      if (duration > 1) {
        logger.warn({ duration }, 'Long-running transaction detected');
      }

      return result;
    })
    .catch(error => {
      timer({ status: 'failed' });
      dbTransactionCounter.labels('failed').inc();

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        duration: (Date.now() - startTime) / 1000
      }, 'Transaction failed');

      throw error;
    });
}

/**
 * Queue operation tracking
 */
export function trackQueueOperation(operation: 'rebuild' | 'incremental_add' | 'incremental_remove' | 'clear'): void {
  queueOperationsCounter.labels(operation).inc();

  logger.debug({
    operation,
    timestamp: new Date().toISOString()
  }, 'Queue operation tracked');
}

export function trackQueueOptimization(type: 'skipped_rebuild' | 'incremental_update', savedOperations: number = 1): void {
  queueOptimizationGauge.labels(type).inc(savedOperations);

  logger.debug({
    optimizationType: type,
    savedOperations
  }, 'Queue operation optimized');
}

/**
 * Connection pool monitoring
 */
export function trackConnectionPoolEvent(eventType: 'acquired' | 'released' | 'timeout' | 'error'): void {
  dbConnectionPoolGauge.labels(eventType).inc();

  if (eventType === 'timeout' || eventType === 'error') {
    logger.warn({ eventType }, 'Database connection pool issue');
  }
}

/**
 * Get comprehensive database metrics for health checks
 */
export function getDatabaseMetrics(): {
  totalQueries: number;
  slowQueries: number;
  failedQueries: number;
  transactionSuccess: number;
  transactionFailures: number;
  queueOptimizations: number;
} {
  // Note: In production, you'd want to use prom-client's metric gathering
  // This is a simplified version for basic health reporting
  return {
    totalQueries: 0, // Would aggregate from dbQueryCounter
    slowQueries: 0,  // Would aggregate from dbSlowQueryCounter
    failedQueries: 0, // Would aggregate from failed queries
    transactionSuccess: 0, // Would aggregate from dbTransactionCounter
    transactionFailures: 0,
    queueOptimizations: 0 // Would aggregate from queueOptimizationGauge
  };
}

/**
 * Database performance summary for monitoring dashboards
 */
export interface DatabasePerformanceSummary {
  health: 'excellent' | 'good' | 'warning' | 'critical';
  queryPerformance: {
    averageLatency: number;
    slowQueryPercentage: number;
    errorRate: number;
  };
  connectionPool: {
    status: 'healthy' | 'stressed' | 'exhausted';
    timeouts: number;
    errors: number;
  };
  optimizations: {
    queueRebuildsSaved: number;
    incrementalUpdates: number;
  };
}

export function generatePerformanceSummary(): DatabasePerformanceSummary {
  // This would be implemented with actual metric aggregation in production
  return {
    health: 'good',
    queryPerformance: {
      averageLatency: 0,
      slowQueryPercentage: 0,
      errorRate: 0
    },
    connectionPool: {
      status: 'healthy',
      timeouts: 0,
      errors: 0
    },
    optimizations: {
      queueRebuildsSaved: 0,
      incrementalUpdates: 0
    }
  };
}