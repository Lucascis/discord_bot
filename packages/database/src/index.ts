import { PrismaClient } from '@prisma/client';
import { logger } from '@discord-bot/logger';
import { createQueryInstrumentationMiddleware } from './metrics.js';

// Enhanced Prisma Client with optimized connection pooling
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=25&pool_timeout=20&socket_timeout=60'
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

prisma.$on('query', (e) => {
  queryCount++;
  totalQueryTime += e.duration;

  // Log slow queries (>100ms)
  if (e.duration > 100) {
    slowQueryCount++;
    logger.warn({
      query: e.query,
      params: e.params,
      duration: e.duration,
      target: e.target
    }, 'Slow database query detected');
  }

  // Log very slow queries with full context (>500ms)
  if (e.duration > 500) {
    logger.error({
      query: e.query,
      params: e.params,
      duration: e.duration,
      target: e.target,
      timestamp: e.timestamp
    }, 'Very slow database query - requires optimization');
  }
});

prisma.$on('info', (e) => {
  logger.info({ message: e.message, target: e.target }, 'Database info');
});

prisma.$on('warn', (e) => {
  logger.warn({ message: e.message, target: e.target }, 'Database warning');
});

prisma.$on('error', (e) => {
  logger.error({ message: e.message, target: e.target }, 'Database error');
});

// Enable automatic query instrumentation only if $use method exists
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (prisma as any).$use === 'function') {
  createQueryInstrumentationMiddleware(prisma);
}

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
    logger.error({ error }, 'Database health check failed');
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
    logger.info('Database connection closed gracefully');
  } catch (error) {
    logger.error({ error }, 'Error closing database connection');
  }
}

// Reset metrics (useful for testing)
export function resetDatabaseMetrics(): void {
  queryCount = 0;
  slowQueryCount = 0;
  totalQueryTime = 0;
}

export { PrismaClient } from '@prisma/client';

export {
  TransactionManager,
  TransactionError,
  getTransactionManager,
  TransactionPatterns,
  type TransactionOptions,
  type TransactionMetrics
} from './transaction-manager.js';

export * from './metrics.js';
