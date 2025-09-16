import express, { type Express } from 'express';
import cors from 'cors';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { HealthChecker, CommonHealthChecks, logger } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';
import { getCorsManager } from '@discord-bot/security';
import { env } from '@discord-bot/config';

export const app: Express = express();

// Security Configuration
const corsManager = getCorsManager(env.NODE_ENV);

// Apply security middleware first
app.use(corsManager.getSecurityMiddleware());

// CORS configuration
app.use(cors(corsManager.getCorsOptions()));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API key protection for sensitive endpoints (if needed)
const apiKeyMiddleware = corsManager.getApiKeyMiddleware(env.API_KEY);

// Rate limiting could be added here
// app.use('/api', rateLimitMiddleware);

// Health Check Setup
const healthChecker = new HealthChecker('api', '1.0.0');

// Register health checks
healthChecker.register('database', () => CommonHealthChecks.database(prisma));
healthChecker.register('memory', () => CommonHealthChecks.memory(512));

// Enhanced health endpoint
app.get('/health', async (_req, res) => {
  try {
    const health = await healthChecker.check();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      service: 'api',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Simple readiness probe
app.get('/ready', (_req, res) => {
  res.json({ ready: true, timestamp: new Date().toISOString() });
});

// Metrics endpoint (protected)
const registry = new Registry();
collectDefaultMetrics({ register: registry });
app.get('/metrics', apiKeyMiddleware, async (_req, res) => {
  try {
    res.setHeader('content-type', registry.contentType);
    res.send(await registry.metrics());
  } catch (error) {
    logger.error({ error }, 'Failed to generate metrics');
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

// CORS and security info endpoint
app.get('/security/info', (_req, res) => {
  try {
    const corsMetrics = corsManager.getMetrics();
    res.json({
      cors: corsMetrics,
      security: {
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get security info');
    res.status(500).json({ error: 'Failed to get security info' });
  }
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  }, 'Unhandled error in API');

  res.status((err as any).status || 500).json({
    error: 'Internal Server Error',
    message: env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    requestId: res.getHeader('X-Request-ID')
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn({
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  }, 'API endpoint not found');

  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString(),
    requestId: res.getHeader('X-Request-ID')
  });
});
