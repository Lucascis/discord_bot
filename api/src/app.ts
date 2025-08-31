import express, { type Express } from 'express';
import { Registry, collectDefaultMetrics } from 'prom-client';

export const app: Express = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });
app.get('/metrics', async (_req, res) => {
  res.setHeader('content-type', registry.contentType);
  res.send(await registry.metrics());
});
