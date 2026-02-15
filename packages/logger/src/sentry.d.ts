import { SentryStub } from './sentry-stub.js';
declare let Sentry: SentryStub;
interface SentryConfig {
    dsn?: string;
    environment: string;
    serviceName: string;
    debug?: boolean;
    tracesSampleRate?: number;
    profilesSampleRate?: number;
}
/**
 * Initialize Sentry error monitoring
 */
export declare function initializeSentry(config: SentryConfig): Promise<void>;
/**
 * Capture an error with context
 */
export declare function captureError(error: Error, context?: Record<string, unknown>): string;
/**
 * Capture a message with level
 */
export declare function captureMessage(message: string, level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal', context?: Record<string, unknown>): string;
/**
 * Add breadcrumb for tracing
 */
export declare function addBreadcrumb(message: string, category?: string, level?: 'debug' | 'info' | 'warning' | 'error', data?: Record<string, unknown>): void;
/**
 * Set user context for error tracking
 */
export declare function setUser(userId: string, guildId?: string): void;
/**
 * Set custom tags for filtering
 */
export declare function setTags(tags: Record<string, string>): void;
/**
 * Start a performance transaction
 */
export declare function startTransaction(name: string, op?: string): unknown | undefined;
/**
 * Flush pending events (useful for graceful shutdown)
 */
export declare function flush(timeout?: number): Promise<boolean>;
/**
 * Close Sentry client
 */
export declare function close(timeout?: number): Promise<boolean>;
export { Sentry };
//# sourceMappingURL=sentry.d.ts.map