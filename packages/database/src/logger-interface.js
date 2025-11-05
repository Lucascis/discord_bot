/**
 * No-op logger implementation for when no logger is provided
 */
export class NoOpLogger {
    info() {
        // No operation
    }
    warn() {
        // No operation
    }
    error() {
        // No operation
    }
}
/**
 * Console fallback logger for development
 */
export class ConsoleLogger {
    info(obj, msg) {
        console.log('[DATABASE INFO]', msg || '', obj);
    }
    warn(obj, msg) {
        console.warn('[DATABASE WARN]', msg || '', obj);
    }
    error(obj, msg) {
        console.error('[DATABASE ERROR]', msg || '', obj);
    }
}
/**
 * Global logger instance - can be injected by consuming packages
 */
let globalLogger = new ConsoleLogger();
/**
 * Inject a logger implementation
 */
export function injectLogger(logger) {
    globalLogger = logger;
}
/**
 * Get the current logger instance
 */
export function getLogger() {
    return globalLogger;
}
