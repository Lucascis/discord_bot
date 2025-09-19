/**
 * Database Logger Interface
 * Abstraction to avoid circular dependencies with @discord-bot/logger
 */
export interface DatabaseLogger {
  info(obj: any, msg?: string): void;
  warn(obj: any, msg?: string): void;
  error(obj: any, msg?: string): void;
}

/**
 * No-op logger implementation for when no logger is provided
 */
export class NoOpLogger implements DatabaseLogger {
  info(): void {
    // No operation
  }

  warn(): void {
    // No operation
  }

  error(): void {
    // No operation
  }
}

/**
 * Console fallback logger for development
 */
export class ConsoleLogger implements DatabaseLogger {
  info(obj: any, msg?: string): void {
    console.log('[DATABASE INFO]', msg || '', obj);
  }

  warn(obj: any, msg?: string): void {
    console.warn('[DATABASE WARN]', msg || '', obj);
  }

  error(obj: any, msg?: string): void {
    console.error('[DATABASE ERROR]', msg || '', obj);
  }
}

/**
 * Global logger instance - can be injected by consuming packages
 */
let globalLogger: DatabaseLogger = new ConsoleLogger();

/**
 * Inject a logger implementation
 */
export function injectLogger(logger: DatabaseLogger): void {
  globalLogger = logger;
}

/**
 * Get the current logger instance
 */
export function getLogger(): DatabaseLogger {
  return globalLogger;
}