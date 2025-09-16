// Tracing exports
export {
  TelemetryManager
} from './tracing/tracer.js';

export type {
  TelemetryConfig
} from './tracing/tracer.js';

// Metrics exports
export {
  MetricsCollector
} from './metrics/metrics-collector.js';

// Re-export OpenTelemetry types for convenience
export {
  trace,
  metrics,
  SpanStatusCode,
  SpanKind
} from '@opentelemetry/api';