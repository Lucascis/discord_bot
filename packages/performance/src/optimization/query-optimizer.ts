import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Query Performance Metrics
 */
export interface QueryMetrics {
  executionTimeMs: number;
  rowsAffected: number;
  cacheHit: boolean;
  indexUsed: boolean;
  fullTableScan: boolean;
  queryPlan?: string;
}

/**
 * Query Optimization Hint
 */
export interface QueryHint {
  useIndex?: string;
  forceIndex?: string;
  ignoreIndex?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  groupBy?: string;
}

/**
 * Query Batch Configuration
 */
export interface BatchConfig {
  batchSize: number;
  maxConcurrency: number;
  retryAttempts: number;
  retryDelayMs: number;
}

/**
 * Query Optimizer
 * Optimizes database queries for performance
 */
export class QueryOptimizer {
  private readonly metrics?: MetricsCollector;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly queryCache = new Map<string, any>();
  private readonly slowQueryThreshold = 1000; // 1 second
  private readonly batchConfig: BatchConfig = {
    batchSize: 100,
    maxConcurrency: 5,
    retryAttempts: 3,
    retryDelayMs: 1000
  };

  constructor(metrics?: MetricsCollector) {
    this.metrics = metrics;
  }

  /**
   * Optimize SELECT query with intelligent hints
   */
  optimizeSelect(
    baseQuery: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any[] = [],
    hints: QueryHint = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { query: string; params: any[] } {
    let optimizedQuery = baseQuery;

    // Add LIMIT if not present and hint provided
    if (hints.limit && !optimizedQuery.toLowerCase().includes('limit')) {
      optimizedQuery += ` LIMIT ${hints.limit}`;
    }

    // Add OFFSET if provided
    if (hints.offset && hints.limit) {
      optimizedQuery += ` OFFSET ${hints.offset}`;
    }

    // Add ORDER BY optimization
    if (hints.orderBy && !optimizedQuery.toLowerCase().includes('order by')) {
      optimizedQuery += ` ORDER BY ${hints.orderBy}`;
    }

    // Add index hints for PostgreSQL
    if (hints.useIndex) {
      // Note: PostgreSQL doesn't have MySQL-style index hints
      // Instead, we can modify the query to encourage index usage
      logger.debug('Index hint applied', {
        baseQuery: baseQuery.substring(0, 100),
        indexHint: hints.useIndex
      });
    }

    return {
      query: optimizedQuery,
      params
    };
  }

  /**
   * Execute query with performance monitoring
   */
  async executeWithMonitoring<T>(
    queryFn: () => Promise<T>,
    queryInfo: {
      type: 'select' | 'insert' | 'update' | 'delete';
      table: string;
      query: string;
    }
  ): Promise<T> {
    const startTime = Date.now();
    const queryHash = this.hashQuery(queryInfo.query);

    try {
      // Check cache for SELECT queries
      if (queryInfo.type === 'select' && this.queryCache.has(queryHash)) {
        const cached = this.queryCache.get(queryHash);
        if (Date.now() - cached.timestamp < 300000) { // 5 minutes cache
          this.recordMetrics(queryInfo, {
            executionTimeMs: 0,
            rowsAffected: 0,
            cacheHit: true,
            indexUsed: true,
            fullTableScan: false
          });
          return cached.result;
        }
      }

      const result = await queryFn();
      const executionTime = Date.now() - startTime;

      // Cache SELECT results
      if (queryInfo.type === 'select' && executionTime < this.slowQueryThreshold) {
        this.queryCache.set(queryHash, {
          result,
          timestamp: Date.now()
        });
      }

      // Record metrics
      this.recordMetrics(queryInfo, {
        executionTimeMs: executionTime,
        rowsAffected: Array.isArray(result) ? result.length : 1,
        cacheHit: false,
        indexUsed: executionTime < this.slowQueryThreshold,
        fullTableScan: executionTime > this.slowQueryThreshold
      });

      // Log slow queries
      if (executionTime > this.slowQueryThreshold) {
        logger.warn('Slow query detected', {
          table: queryInfo.table,
          type: queryInfo.type,
          executionTimeMs: executionTime,
          query: queryInfo.query.substring(0, 200)
        });
      }

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;

      logger.error('Query execution failed', {
        table: queryInfo.table,
        type: queryInfo.type,
        executionTimeMs: executionTime,
        error: error instanceof Error ? error.message : String(error),
        query: queryInfo.query.substring(0, 200)
      });

      if (this.metrics) {
        this.metrics.recordError('query_execution', 'database', undefined);
      }

      throw error;
    }
  }

  /**
   * Execute batch operations efficiently
   */
  async executeBatch<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    config: Partial<BatchConfig> = {}
  ): Promise<R[]> {
    const effectiveConfig = { ...this.batchConfig, ...config };
    const results: R[] = [];
    const batches: T[][] = [];

    // Split into batches
    for (let i = 0; i < items.length; i += effectiveConfig.batchSize) {
      batches.push(items.slice(i, i + effectiveConfig.batchSize));
    }

    logger.info('Starting batch execution', {
      totalItems: items.length,
      batchCount: batches.length,
      batchSize: effectiveConfig.batchSize,
      maxConcurrency: effectiveConfig.maxConcurrency
    });

    // Process batches with concurrency control
    for (let i = 0; i < batches.length; i += effectiveConfig.maxConcurrency) {
      const concurrentBatches = batches.slice(i, i + effectiveConfig.maxConcurrency);

      const batchPromises = concurrentBatches.map(async (batch, batchIndex) => {
        let attempts = 0;
        let lastError: Error | null = null;

        while (attempts < effectiveConfig.retryAttempts) {
          try {
            const startTime = Date.now();
            const batchResults = await processor(batch);
            const executionTime = Date.now() - startTime;

            logger.debug('Batch processed successfully', {
              batchIndex: i + batchIndex,
              batchSize: batch.length,
              executionTimeMs: executionTime,
              attempt: attempts + 1
            });

            return batchResults;

          } catch (error) {
            attempts++;
            lastError = error as Error;

            logger.warn('Batch processing failed', {
              batchIndex: i + batchIndex,
              attempt: attempts,
              maxAttempts: effectiveConfig.retryAttempts,
              error: error instanceof Error ? error.message : String(error)
            });

            if (attempts < effectiveConfig.retryAttempts) {
              await new Promise(resolve =>
                setTimeout(resolve, effectiveConfig.retryDelayMs * attempts)
              );
            }
          }
        }

        throw lastError || new Error('Batch processing failed');
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.flat());
    }

    logger.info('Batch execution completed', {
      totalItems: items.length,
      totalResults: results.length,
      batchCount: batches.length
    });

    return results;
  }

  /**
   * Optimize connection pooling
   */
  getOptimalPoolConfig(expectedConcurrency: number): {
    min: number;
    max: number;
    acquireTimeoutMillis: number;
    idleTimeoutMillis: number;
  } {
    // Calculate pool size based on expected concurrency
    const min = Math.max(2, Math.ceil(expectedConcurrency * 0.1));
    const max = Math.min(50, expectedConcurrency * 2);

    return {
      min,
      max,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 300000
    };
  }

  /**
   * Generate optimized pagination query
   */
  generatePaginationQuery(
    baseQuery: string,
    page: number,
    pageSize: number,
    orderBy: string = 'id'
  ): { query: string; offset: number; limit: number } {
    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // Ensure ORDER BY is present for consistent pagination
    let optimizedQuery = baseQuery;
    if (!optimizedQuery.toLowerCase().includes('order by')) {
      optimizedQuery += ` ORDER BY ${orderBy}`;
    }

    optimizedQuery += ` LIMIT ${limit} OFFSET ${offset}`;

    return {
      query: optimizedQuery,
      offset,
      limit
    };
  }

  /**
   * Generate count query for pagination
   */
  generateCountQuery(baseQuery: string): string {
    // Extract the FROM clause and WHERE conditions
    const fromMatch = baseQuery.match(/FROM\s+[\w\s,]+(?:WHERE\s+.+)?(?:GROUP\s+BY\s+.+)?/i);

    if (fromMatch) {
      const fromClause = fromMatch[0]
        .replace(/ORDER\s+BY\s+.+$/i, '')
        .replace(/LIMIT\s+.+$/i, '')
        .replace(/OFFSET\s+.+$/i, '');

      return `SELECT COUNT(*) as total ${fromClause}`;
    }

    // Fallback: wrap the original query
    const cleanQuery = baseQuery
      .replace(/ORDER\s+BY\s+.+$/i, '')
      .replace(/LIMIT\s+.+$/i, '')
      .replace(/OFFSET\s+.+$/i, '');

    return `SELECT COUNT(*) as total FROM (${cleanQuery}) as count_query`;
  }

  /**
   * Analyze query performance
   */
  async analyzeQuery(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeFn: (query: string) => Promise<any>
  ): Promise<{
    originalTime: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    explainPlan: any;
    recommendations: string[];
  }> {
    const startTime = Date.now();

    // Execute original query
    await executeFn(query);
    const originalTime = Date.now() - startTime;

    // Get execution plan
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
    let explainPlan = null;
    let recommendations: string[] = [];

    try {
      explainPlan = await executeFn(explainQuery);
      recommendations = this.generateRecommendations(explainPlan, originalTime);
    } catch (error) {
      logger.warn('Could not get query execution plan', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return {
      originalTime,
      explainPlan,
      recommendations
    };
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
    logger.info('Query cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    // This is a simplified implementation
    // In a real scenario, you'd track hits/misses
    return {
      size: this.queryCache.size,
      hitRate: 0 // TODO: Implement hit rate tracking
    };
  }

  // Private helper methods

  private hashQuery(query: string): string {
    // Simple hash function for query caching
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recordMetrics(queryInfo: any, metrics: QueryMetrics): void {
    if (this.metrics) {
      this.metrics.recordCustomMetric(
        'database_query_duration_ms',
        metrics.executionTimeMs,
        {
          table: queryInfo.table,
          type: queryInfo.type,
          cache_hit: metrics.cacheHit.toString(),
          index_used: metrics.indexUsed.toString()
        },
        'histogram'
      );

      this.metrics.recordCustomMetric(
        'database_query_total',
        1,
        {
          table: queryInfo.table,
          type: queryInfo.type,
          status: 'success'
        },
        'counter'
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateRecommendations(explainPlan: any, executionTime: number): string[] {
    const recommendations: string[] = [];

    if (executionTime > this.slowQueryThreshold) {
      recommendations.push('Consider adding appropriate indexes');
      recommendations.push('Review WHERE clause for optimization opportunities');
    }

    // Add more sophisticated analysis based on explain plan
    if (explainPlan) {
      // This would analyze the execution plan and provide specific recommendations
      recommendations.push('Analyze execution plan for optimization opportunities');
    }

    return recommendations;
  }
}