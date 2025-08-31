import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';
import http from 'node:http';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

setInterval(() => {
  logger.info('worker heartbeat');
}, 60000);

// Health + Metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const healthServer = http.createServer(async (req, res) => {
  if (!req.url) return;
  if (req.url.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url.startsWith('/metrics')) {
    res.writeHead(200, { 'content-type': registry.contentType });
    res.end(await registry.metrics());
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(env.WORKER_HTTP_PORT, () => logger.info(`Worker health on :${env.WORKER_HTTP_PORT}`));

// Tracing
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  void sdk.start();
}
