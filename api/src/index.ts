// Load environment variables first
import './env-loader.js';

import { app } from './app.js';
import { logger, initializeSentry } from '@discord-bot/logger';
import { injectLogger } from '@discord-bot/database';
import { env } from '@discord-bot/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

async function startServer() {
  // Inject logger dependency for database package
  injectLogger(logger);

  // Initialize Sentry error monitoring
  await initializeSentry({
    ...(env.SENTRY_DSN && { dsn: env.SENTRY_DSN }),
    environment: env.SENTRY_ENVIRONMENT,
    serviceName: 'api',
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  app.listen(port, () => logger.info(`API listening on ${port}`));

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    void sdk.start();
  }
}

void startServer();
