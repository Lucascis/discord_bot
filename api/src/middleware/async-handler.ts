import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async Handler Wrapper
 *
 * Express.js 5.x has built-in promise handling, but this wrapper provides
 * additional type safety and explicit error handling for async route handlers.
 *
 * Following Express.js 5.x best practices for async middleware
 */

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> | void;

/**
 * Wraps async route handlers to ensure proper error handling
 *
 * While Express 5.x handles promise rejections automatically,
 * this wrapper provides explicit error handling and type safety
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = fn(req, res, next);

      // If the function returns a promise, handle rejections
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (error) {
      // Handle synchronous errors
      next(error);
    }
  };
}

/**
 * Type-safe async middleware wrapper with proper error boundaries
 *
 * This ensures that all async operations in route handlers are properly
 * wrapped and errors are forwarded to the error handling middleware
 */
export function wrapAsync(handler: AsyncRequestHandler): RequestHandler {
  return asyncHandler(handler);
}

/**
 * Utility for handling async middleware that might need cleanup
 *
 * Useful for operations that acquire resources and need cleanup
 * even if an error occurs
 */
export function asyncWithCleanup(
  handler: AsyncRequestHandler,
  cleanup?: () => Promise<void> | void
): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } finally {
      if (cleanup) {
        try {
          await cleanup();
        } catch (cleanupError) {
          // Log cleanup errors but don't override the main error
          console.error('Cleanup error:', cleanupError);
        }
      }
    }
  });
}

/**
 * Timeout wrapper for async handlers
 *
 * Ensures that long-running operations don't hang indefinitely
 */
export function withTimeout(
  handler: AsyncRequestHandler,
  timeoutMs: number = 30000
): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const handlerResult = handler(req, res, next);

    await Promise.race([Promise.resolve(handlerResult), timeoutPromise]);
  });
}
