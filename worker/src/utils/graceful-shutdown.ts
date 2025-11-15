/**
 * Graceful Shutdown Handler for Worker Service
 *
 * Handles SIGTERM and SIGINT signals to ensure clean shutdown
 * Following Node.js best practices and BullMQ graceful shutdown patterns
 */

import { logger } from '@discord-bot/logger';
import { shutdownAllWorkers } from '../workers/bullmq-worker.js';
import { closeRedis } from './redis-client.js';

/**
 * Shutdown state tracking
 */
interface ShutdownState {
  isShuttingDown: boolean;
  shutdownTimeout: NodeJS.Timeout | null;
  forceShutdownTimeout: NodeJS.Timeout | null;
}

const shutdownState: ShutdownState = {
  isShuttingDown: false,
  shutdownTimeout: null,
  forceShutdownTimeout: null
};

/**
 * Graceful shutdown timeout (default: 30 seconds)
 */
const GRACEFUL_SHUTDOWN_TIMEOUT = 30000;

/**
 * Force shutdown timeout (default: 10 seconds after graceful timeout)
 */
const FORCE_SHUTDOWN_TIMEOUT = 10000;

/**
 * Cleanup functions to execute during shutdown
 */
const cleanupFunctions: Array<() => Promise<void>> = [];

/**
 * Add cleanup function to shutdown sequence
 */
export function addCleanupFunction(fn: () => Promise<void>): void {
  cleanupFunctions.push(fn);
}

/**
 * Remove cleanup function from shutdown sequence
 */
export function removeCleanupFunction(fn: () => Promise<void>): void {
  const index = cleanupFunctions.indexOf(fn);
  if (index > -1) {
    cleanupFunctions.splice(index, 1);
  }
}

/**
 * Execute graceful shutdown sequence
 */
async function executeGracefulShutdown(signal: string): Promise<void> {
  if (shutdownState.isShuttingDown) {
    logger.warn(`Received ${signal} but shutdown already in progress`);
    return;
  }

  shutdownState.isShuttingDown = true;

  logger.info({
    signal,
    timeout: GRACEFUL_SHUTDOWN_TIMEOUT,
    cleanupFunctions: cleanupFunctions.length
  }, 'Starting graceful shutdown');

  // Set force shutdown timer
  shutdownState.forceShutdownTimeout = setTimeout(() => {
    logger.error('Force shutdown timeout reached, terminating process');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT + FORCE_SHUTDOWN_TIMEOUT);

  try {
    // 1. Stop accepting new jobs by shutting down workers
    logger.info('Shutting down workers...');
    await shutdownAllWorkers();

    // 2. Execute custom cleanup functions
    if (cleanupFunctions.length > 0) {
      logger.info(`Executing ${cleanupFunctions.length} cleanup functions...`);
      await Promise.all(
        cleanupFunctions.map(async (fn, index) => {
          try {
            await fn();
            logger.debug(`Cleanup function ${index + 1} completed`);
          } catch (error) {
            logger.error({
              error: error instanceof Error ? error.message : String(error),
              functionIndex: index
            }, 'Cleanup function failed');
          }
        })
      );
    }

    // 3. Close Redis connections
    logger.info('Closing Redis connections...');
    await closeRedis();

    // 4. Clear timers
    if (shutdownState.shutdownTimeout) {
      clearTimeout(shutdownState.shutdownTimeout);
    }
    if (shutdownState.forceShutdownTimeout) {
      clearTimeout(shutdownState.forceShutdownTimeout);
    }

    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      signal
    }, 'Error during graceful shutdown');

    // Force exit if graceful shutdown fails
    process.exit(1);
  }
}

/**
 * Handle shutdown signals
 */
function handleShutdownSignal(signal: string): void {
  logger.info(`Received ${signal}, initiating graceful shutdown`);

  // Set main shutdown timeout
  shutdownState.shutdownTimeout = setTimeout(() => {
    logger.warn('Graceful shutdown timeout reached, forcing shutdown');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT);

  // Execute graceful shutdown
  executeGracefulShutdown(signal).catch((error) => {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      signal
    }, 'Failed to execute graceful shutdown');
    process.exit(1);
  });
}

/**
 * Handle uncaught exceptions
 */
function handleUncaughtException(error: Error): void {
  logger.error({
    error: error.message,
    stack: error.stack
  }, 'Uncaught exception, forcing shutdown');

  // Force immediate shutdown for uncaught exceptions
  process.exit(1);
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(reason: unknown, _promise: Promise<unknown>): void {
  logger.error({
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  }, 'Unhandled promise rejection, forcing shutdown');

  // Force immediate shutdown for unhandled rejections
  process.exit(1);
}

type ProcessEvent = NodeJS.Signals | 'uncaughtException' | 'unhandledRejection' | 'exit';
type ProcessListener = (...args: unknown[]) => void;
type HandlerRegistration = { event: ProcessEvent; handler: ProcessListener };

const registeredHandlers: HandlerRegistration[] = [];
let handlersInstalled = false;

function attachProcessHandler(event: ProcessEvent, handler: HandlerRegistration['handler']): void {
  process.addListener(event, handler as ProcessListener);
  registeredHandlers.push({ event, handler });
}

function detachProcessHandler(event: ProcessEvent, handler: HandlerRegistration['handler']): void {
  if (typeof process.off === 'function') {
    process.off(event, handler as ProcessListener);
  } else {
    process.removeListener(event, handler as ProcessListener);
  }
}

/**
 * Initialize graceful shutdown handlers
 */
export function initializeGracefulShutdown(): void {
  if (handlersInstalled) {
    return;
  }

  attachProcessHandler('SIGTERM', () => handleShutdownSignal('SIGTERM'));
  attachProcessHandler('SIGINT', () => handleShutdownSignal('SIGINT'));

  attachProcessHandler('uncaughtException', handleUncaughtException);
  attachProcessHandler('unhandledRejection', handleUnhandledRejection);
  attachProcessHandler('exit', (code: number) => {
    logger.info({ exitCode: code }, 'Worker process exiting');
  });

  handlersInstalled = true;

  logger.info({
    gracefulTimeout: GRACEFUL_SHUTDOWN_TIMEOUT,
    forceTimeout: FORCE_SHUTDOWN_TIMEOUT
  }, 'Graceful shutdown handlers initialized');
}

/**
 * Test-only helper to remove handlers between specs to avoid MaxListeners warnings.
 * NOT exported publicly in generated types to avoid accidental production usage.
 */
export function __resetGracefulShutdownHandlersForTests(): void {
  for (const { event, handler } of registeredHandlers) {
    detachProcessHandler(event, handler);
  }
  registeredHandlers.length = 0;
  handlersInstalled = false;
  shutdownState.isShuttingDown = false;
  if (shutdownState.shutdownTimeout) {
    clearTimeout(shutdownState.shutdownTimeout);
    shutdownState.shutdownTimeout = null;
  }
  if (shutdownState.forceShutdownTimeout) {
    clearTimeout(shutdownState.forceShutdownTimeout);
    shutdownState.forceShutdownTimeout = null;
  }
}

/**
 * Trigger manual shutdown (for testing or admin operations)
 */
export function triggerShutdown(): void {
  logger.info('Manual shutdown triggered');
  handleShutdownSignal('MANUAL');
}

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return shutdownState.isShuttingDown;
}

/**
 * Health check that considers shutdown state
 */
export function getShutdownHealth(): {
  healthy: boolean;
  details: Record<string, unknown>;
} {
  return {
    healthy: !shutdownState.isShuttingDown,
    details: {
      isShuttingDown: shutdownState.isShuttingDown,
      hasShutdownTimeout: shutdownState.shutdownTimeout !== null,
      hasForceShutdownTimeout: shutdownState.forceShutdownTimeout !== null,
      cleanupFunctionsRegistered: cleanupFunctions.length
    }
  };
}
