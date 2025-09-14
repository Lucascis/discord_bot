import { SentryStub } from './sentry-stub.js';

// Use dynamic imports to handle test environment and missing dependencies gracefully
let Sentry: typeof SentryStub = SentryStub;
let nodeProfilingIntegration: (() => Record<string, unknown>) | undefined = undefined;

async function loadSentryDependencies() {
  if (process.env.NODE_ENV === 'test') {
    // Skip Sentry loading in test environment
    return false;
  }

  try {
    // Use eval to bypass TypeScript static analysis
    const sentryModule = await (eval('import("@sentry/node")') as Promise<Record<string, unknown>>);
    Sentry = sentryModule as unknown as typeof SentryStub;
    
    try {
      const profilingModule = await (eval('import("@sentry/profiling-node")') as Promise<Record<string, unknown>>);
      nodeProfilingIntegration = profilingModule.nodeProfilingIntegration as (() => Record<string, unknown>);
    } catch (profilingError) {
      console.warn('Sentry profiling not available, continuing without profiling');
    }
    
    return true;
  } catch (error) {
    console.warn('Sentry modules not available, error monitoring will be disabled:', error);
    Sentry = SentryStub;
    return false;
  }
}

interface SentryConfig {
  dsn?: string;
  environment: string;
  serviceName: string;
  debug?: boolean;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
}

let initialized = false;

/**
 * Initialize Sentry error monitoring
 */
export async function initializeSentry(config: SentryConfig): Promise<void> {
  if (initialized) {
    console.warn('Sentry already initialized');
    return;
  }

  if (!config.dsn) {
    console.log('Sentry DSN not provided, skipping initialization');
    return;
  }

  const loaded = await loadSentryDependencies();
  if (!loaded || !Sentry) {
    console.warn('Sentry dependencies not loaded, skipping initialization');
    return;
  }

  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      debug: config.debug || false,
      tracesSampleRate: config.tracesSampleRate || 0.1,
      profilesSampleRate: config.profilesSampleRate || 0.1,
      
      // Service identification
      serverName: config.serviceName,
      
      // Integrations
      integrations: [
        // Add profiling integration for performance monitoring
        ...(nodeProfilingIntegration ? [nodeProfilingIntegration()] : []),
      ],
      
      // Error filtering
      beforeSend(event: Record<string, unknown>) {
        // Filter out development/test noise
        if (config.environment === 'development' || config.environment === 'test') {
          // Only send errors, not info/debug
          if (event.level !== 'error' && event.level !== 'fatal') {
            return null;
          }
        }

        // Filter out known non-critical errors
        const exception = event.exception as { values?: Array<{ value?: string }> } | undefined;
        const message = (event.message as string) || exception?.values?.[0]?.value || '';
        
        // Skip Discord API rate limits (these are handled gracefully)
        if (message.includes('rate limit') || message.includes('429')) {
          return null;
        }

        // Skip network timeouts that are recoverable
        if (message.includes('ECONNRESET') || message.includes('ETIMEDOUT')) {
          return null;
        }

        return event;
      },

      // Performance monitoring
      beforeTransaction(transaction: Record<string, unknown>) {
        // Sample based on transaction name
        if ((transaction.name as string)?.includes('health-check')) {
          // Lower sampling for health checks
          transaction.sampled = Math.random() < 0.01;
        }
        
        return transaction;
      }
    });

    // Set service context
    Sentry.setContext('service', {
      name: config.serviceName,
      environment: config.environment,
      version: process.env.npm_package_version || 'unknown'
    });

    initialized = true;
    console.log(`Sentry initialized for ${config.serviceName} in ${config.environment}`);
  } catch (error) {
    console.error('Failed to initialize Sentry:', error);
  }
}

/**
 * Capture an error with context
 */
export function captureError(error: Error, context?: Record<string, unknown>): string {
  if (!initialized || !Sentry) {
    console.error('Sentry not initialized, logging error:', error);
    return '';
  }

  return Sentry.captureException(error, {
    contexts: context ? { custom: context } : undefined,
    level: 'error'
  });
}

/**
 * Capture a message with level
 */
export function captureMessage(
  message: string, 
  level: 'debug' | 'info' | 'warning' | 'error' | 'fatal' = 'info',
  context?: Record<string, unknown>
): string {
  if (!initialized || !Sentry) {
    console.log(`Sentry not initialized, logging ${level}:`, message);
    return '';
  }

  return Sentry.captureMessage(message, {
    level,
    contexts: context ? { custom: context } : undefined
  });
}

/**
 * Add breadcrumb for tracing
 */
export function addBreadcrumb(
  message: string,
  category?: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  data?: Record<string, unknown>
): void {
  if (!initialized || !Sentry) return;

  Sentry.addBreadcrumb({
    message,
    category: category || 'custom',
    level,
    data,
    timestamp: Date.now() / 1000
  });
}

/**
 * Set user context for error tracking
 */
export function setUser(userId: string, guildId?: string): void {
  if (!initialized || !Sentry) return;

  Sentry.setUser({
    id: userId,
    ...(guildId && { guild: guildId })
  });
}

/**
 * Set custom tags for filtering
 */
export function setTags(tags: Record<string, string>): void {
  if (!initialized || !Sentry) return;

  Sentry.setTags(tags);
}

/**
 * Start a performance transaction
 */
export function startTransaction(name: string, op?: string): unknown | undefined {
  if (!initialized || !Sentry) return undefined;

  return Sentry.startTransaction({ 
    name, 
    op: op || 'custom'
  });
}

/**
 * Flush pending events (useful for graceful shutdown)
 */
export async function flush(timeout = 5000): Promise<boolean> {
  if (!initialized || !Sentry) return true;
  
  try {
    return await Sentry.flush(timeout);
  } catch (error) {
    console.error('Failed to flush Sentry events:', error);
    return false;
  }
}

/**
 * Close Sentry client
 */
export async function close(timeout = 2000): Promise<boolean> {
  if (!initialized || !Sentry) return true;
  
  try {
    const result = await Sentry.close(timeout);
    initialized = false;
    return result;
  } catch (error) {
    console.error('Failed to close Sentry client:', error);
    return false;
  }
}

// Export Sentry for advanced usage (may be undefined in test environment)
export { Sentry };