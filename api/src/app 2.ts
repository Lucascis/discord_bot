import express, { type Express } from 'express';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { HealthChecker, CommonHealthChecks } from '@discord-bot/logger';
import { prisma } from '@discord-bot/database';

export const app: Express = express();

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

// Metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });
app.get('/metrics', async (_req, res) => {
  res.setHeader('content-type', registry.contentType);
  res.send(await registry.metrics());
});
