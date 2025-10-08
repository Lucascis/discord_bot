import type { Request, Response, NextFunction } from 'express';
import { logger } from '@discord-bot/logger';

/**
 * Custom Error Classes for API
 * Following Express.js 5.x best practices
 */
export class APIError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends APIError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends APIError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends APIError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends APIError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends APIError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends APIError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class InternalServerError extends APIError {
  constructor(message = 'Internal server error', details?: unknown) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', details);
    this.name = 'InternalServerError';
  }
}

/**
 * Standard API Error Response Format
 */
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    timestamp: string;
    requestId?: string;
    details?: unknown;
  };
}

/**
 * Enhanced Error Handler Middleware
 * Replaces basic error handling with structured responses
 * Following Express.js 5.x error handling patterns
 */
export function errorHandler(
  err: Error | APIError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Default error values
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal server error';
  let details: unknown;

  // Handle known API errors
  if (err instanceof APIError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else {
    // Handle unexpected errors
    message = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
  }

  // Extract request ID for tracing
  const requestId = req.headers['x-request-id'] as string;

  // Log error with context
  logger.error({
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code,
      statusCode
    },
    request: {
      id: requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    }
  }, `API Error: ${code}`);

  // Build error response
  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
      timestamp: new Date().toISOString(),
      requestId
    }
  };

  // Add details if they exist
  if (details) {
    errorResponse.error.details = details;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found Handler
 * Must be placed after all routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  const error = new NotFoundError(`Route ${req.method} ${req.path}`);

  logger.warn({
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }
  }, 'Route not found');

  res.status(404).json({
    error: {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    }
  });
}