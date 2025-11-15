import { PrismaClient } from '@prisma/client';
import { getLogger } from './logger-interface.js';

// Enhanced Prisma Client with optimized connection pooling
function buildOptimizedDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const { searchParams } = parsed;

    const ensureParam = (key: string, value: string) => {
      if (!searchParams.has(key)) {
        searchParams.set(key, value);
      }
    };

    ensureParam('connection_limit', '25');
    ensureParam('pool_timeout', '20');
    ensureParam('socket_timeout', '60');

    parsed.search = searchParams.toString();
    return parsed.toString();
  } catch (error) {
    getLogger().warn({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to parse DATABASE_URL - using raw value');
    return rawUrl;
  }
}

const datasourceUrl = process.env.DATABASE_URL
  ? buildOptimizedDatabaseUrl(process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: datasourceUrl
    }
  },
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info', emit: 'event' },
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' }
  ]
});

// Database performance monitoring
let queryCount = 0;
let slowQueryCount = 0;
let totalQueryTime = 0;

// Only set up event listeners if $on method exists (not in testing mocks)
if (typeof prisma.$on === 'function') {
  prisma.$on('query', (e) => {
    queryCount++;
    totalQueryTime += e.duration;

    // Log slow queries (>100ms)
    if (e.duration > 100) {
      slowQueryCount++;
      getLogger().warn({
        query: e.query,
        params: e.params,
        duration: e.duration,
        target: e.target
      }, 'Slow database query detected');
    }

    // Log very slow queries with full context (>500ms)
    if (e.duration > 500) {
      getLogger().error({
        query: e.query,
        params: e.params,
        duration: e.duration,
        target: e.target,
        timestamp: e.timestamp
      }, 'Very slow database query - requires optimization');
    }
  });

  prisma.$on('info', (e) => {
    getLogger().info({ message: e.message, target: e.target }, 'Database info');
  });

  prisma.$on('warn', (e) => {
    getLogger().warn({ message: e.message, target: e.target }, 'Database warning');
  });

  prisma.$on('error', (e) => {
    getLogger().error({ message: e.message, target: e.target }, 'Database error');
  });
}

// Query instrumentation is disabled (metrics module not available)

// Connection health monitoring
export async function checkDatabaseHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  connectionPool: 'active' | 'exhausted' | 'unknown';
  metrics: {
    queryCount: number;
    slowQueryCount: number;
    averageQueryTime: number;
    slowQueryPercentage: number;
  };
  responseTime: number;
}> {
  const startTime = Date.now();

  try {
    // Simple connectivity test
    await prisma.$queryRaw`SELECT 1`;

    const responseTime = Date.now() - startTime;
    const averageQueryTime = queryCount > 0 ? totalQueryTime / queryCount : 0;
    const slowQueryPercentage = queryCount > 0 ? (slowQueryCount / queryCount) * 100 : 0;

    // Connection pool status estimation
    let connectionPool: 'active' | 'exhausted' | 'unknown' = 'unknown';
    if (responseTime < 50) {
      connectionPool = 'active';
    } else if (responseTime > 1000) {
      connectionPool = 'exhausted';
    }

    return {
      status: responseTime < 2000 ? 'healthy' : 'unhealthy',
      connectionPool,
      metrics: {
        queryCount,
        slowQueryCount,
        averageQueryTime: Math.round(averageQueryTime * 100) / 100,
        slowQueryPercentage: Math.round(slowQueryPercentage * 100) / 100
      },
      responseTime
    };
  } catch (error) {
    getLogger().error({ error }, 'Database health check failed');
    return {
      status: 'unhealthy',
      connectionPool: 'unknown',
      metrics: {
        queryCount,
        slowQueryCount,
        averageQueryTime: 0,
        slowQueryPercentage: 0
      },
      responseTime: Date.now() - startTime
    };
  }
}

// Graceful connection management
export async function closeDatabaseConnection(): Promise<void> {
  try {
    await prisma.$disconnect();
    getLogger().info({ message: 'Database connection closed gracefully' });
  } catch (error) {
    getLogger().error({ error }, 'Error closing database connection');
  }
}

// Reset metrics (useful for testing)
export function resetDatabaseMetrics(): void {
  queryCount = 0;
  slowQueryCount = 0;
  totalQueryTime = 0;
}

export { PrismaClient, SubscriptionTier, BillingInterval } from '@prisma/client';
export type { Prisma } from '@prisma/client';

// Logger dependency injection
export { injectLogger, type DatabaseLogger } from './logger-interface.js';

export {
  TransactionManager,
  TransactionError,
  getTransactionManager,
  TransactionPatterns,
  type TransactionOptions,
  type TransactionMetrics
} from './transaction-manager.js';

// Metrics exports disabled (module not available)
