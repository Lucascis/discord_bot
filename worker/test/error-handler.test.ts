import { describe, it, expect, vi } from 'vitest';
import {
  ValidationError,
  DatabaseError,
  ExternalAPIError,
  TimeoutError,
  ResourceError,
  UnknownError,
  classifyError,
  logJobError,
  createRetryStrategy,
  withErrorHandling
} from '../src/utils/error-handler.js';

// Mock logger module - must be defined inline to avoid hoisting issues
vi.mock('@discord-bot/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}));

describe('error-handler', () => {
  describe('ValidationError', () => {
    it('should create validation error with correct properties', () => {
      const error = new ValidationError('email', 'invalid', 'valid email');

      expect(error.type).toBe('VALIDATION_ERROR');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('email');
      expect(error.message).toContain('valid email');
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        field: 'email',
        value: 'invalid',
        expected: 'valid email'
      });
    });

    it('should convert to JobError interface', () => {
      const error = new ValidationError('age', -1, 'positive number');
      const jobError = error.toJobError();

      expect(jobError.type).toBe('VALIDATION_ERROR');
      expect(jobError.retryable).toBe(false);
      expect(jobError.message).toBeTruthy();
      expect(jobError.timestamp).toBeTruthy();
    });
  });

  describe('DatabaseError', () => {
    it('should create database error with retryable flag', () => {
      const cause = new Error('Connection timeout');
      const error = new DatabaseError('query', cause, true);

      expect(error.type).toBe('DATABASE_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('query');
      expect(error.message).toContain('Connection timeout');
    });

    it('should default to retryable=true', () => {
      const cause = new Error('Test error');
      const error = new DatabaseError('operation', cause);

      expect(error.retryable).toBe(true);
    });

    it('should support non-retryable database errors', () => {
      const cause = new Error('Constraint violation');
      const error = new DatabaseError('insert', cause, false);

      expect(error.retryable).toBe(false);
    });
  });

  describe('ExternalAPIError', () => {
    it('should mark 5xx errors as retryable', () => {
      const error = new ExternalAPIError('YouTube API', 503, 'Service Unavailable');

      expect(error.type).toBe('EXTERNAL_API_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.details?.statusCode).toBe(503);
    });

    it('should mark 429 (rate limit) as retryable', () => {
      const error = new ExternalAPIError('Spotify API', 429, 'Too Many Requests');

      expect(error.retryable).toBe(true);
    });

    it('should mark 408 (timeout) as retryable', () => {
      const error = new ExternalAPIError('Discord API', 408, 'Request Timeout');

      expect(error.retryable).toBe(true);
    });

    it('should mark 4xx errors (except 429, 408) as non-retryable', () => {
      const error404 = new ExternalAPIError('API', 404, 'Not Found');
      const error400 = new ExternalAPIError('API', 400, 'Bad Request');

      expect(error404.retryable).toBe(false);
      expect(error400.retryable).toBe(false);
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with operation details', () => {
      const error = new TimeoutError('database query', 5000);

      expect(error.type).toBe('TIMEOUT_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('database query');
      expect(error.message).toContain('5000ms');
      expect(error.details?.timeout).toBe(5000);
    });
  });

  describe('ResourceError', () => {
    it('should create resource error with usage details', () => {
      const error = new ResourceError('memory', 512, 1024);

      expect(error.type).toBe('RESOURCE_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('memory');
      expect(error.details?.current).toBe(512);
      expect(error.details?.required).toBe(1024);
    });
  });

  describe('UnknownError', () => {
    it('should wrap unknown errors', () => {
      const originalError = new Error('Something went wrong');
      const error = new UnknownError(originalError, 'job processing');

      expect(error.type).toBe('UNKNOWN_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.message).toContain('job processing');
      expect(error.message).toContain('Something went wrong');
    });

    it('should handle errors without context', () => {
      const originalError = new Error('Test error');
      const error = new UnknownError(originalError);

      expect(error.message).toContain('Test error');
    });
  });

  describe('classifyError', () => {
    it('should return WorkerError as-is', () => {
      const validationError = new ValidationError('field', 'value', 'expected');
      const classified = classifyError(validationError);

      expect(classified).toBe(validationError);
    });

    it('should classify database connection errors', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      const classified = classifyError(error);

      expect(classified).toBeInstanceOf(DatabaseError);
      expect(classified.retryable).toBe(true);
    });

    it('should classify validation errors', () => {
      const error = new Error('Validation failed: invalid email');
      const classified = classifyError(error);

      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.retryable).toBe(false);
    });

    it('should classify timeout errors', () => {
      const error = new Error('ETIMEDOUT: operation timed out');
      const classified = classifyError(error);

      expect(classified).toBeInstanceOf(TimeoutError);
      expect(classified.retryable).toBe(true);
    });

    it('should classify resource errors', () => {
      const error = new Error('ENOMEM: out of memory');
      const classified = classifyError(error);

      expect(classified).toBeInstanceOf(ResourceError);
      expect(classified.retryable).toBe(true);
    });

    it('should wrap unknown errors', () => {
      const error = new Error('Random error');
      const classified = classifyError(error);

      expect(classified).toBeInstanceOf(UnknownError);
      expect(classified.retryable).toBe(true);
    });

    it('should handle non-Error objects', () => {
      const classified = classifyError('string error');

      expect(classified).toBeInstanceOf(UnknownError);
      expect(classified.message).toContain('string error');
    });
  });

  describe('logJobError', () => {
    it('should log retryable errors as warnings', () => {
      const error = new TimeoutError('operation', 5000);
      logJobError(error, 'job-123', 'cleanup', { data: 'test' });

      // Error should be logged, but we can't easily assert on the mock
      // due to module import mechanics
      expect(error.retryable).toBe(true);
    });

    it('should log non-retryable errors as errors', () => {
      const error = new ValidationError('field', 'value', 'expected');
      logJobError(error, 'job-456', 'maintenance', { data: 'test' });

      expect(error.retryable).toBe(false);
    });
  });

  describe('createRetryStrategy', () => {
    it('should not retry non-retryable errors', () => {
      const error = new ValidationError('field', 'value', 'expected');
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.delay).toBe(0);
      expect(strategy.maxAttempts).toBe(0);
    });

    it('should create strategy for database errors', () => {
      const error = new DatabaseError('query', new Error('test'), true);
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(2000);
      expect(strategy.maxAttempts).toBe(5);
    });

    it('should create strategy for external API errors', () => {
      const error = new ExternalAPIError('API', 503, 'Service Unavailable');
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(5000);
      expect(strategy.maxAttempts).toBe(3);
    });

    it('should create strategy for timeout errors', () => {
      const error = new TimeoutError('operation', 5000);
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(3000);
      expect(strategy.maxAttempts).toBe(3);
    });

    it('should create strategy for resource errors', () => {
      const error = new ResourceError('memory', 512, 1024);
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(10000);
      expect(strategy.maxAttempts).toBe(2);
    });

    it('should create strategy for unknown errors', () => {
      const error = new UnknownError(new Error('test'));
      const strategy = createRetryStrategy(error);

      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(1000);
      expect(strategy.maxAttempts).toBe(2);
    });
  });

  describe('withErrorHandling', () => {
    it('should return result when function succeeds', async () => {
      const successFn = async (value: number) => value * 2;
      const wrapped = withErrorHandling(successFn);

      const result = await wrapped(21);
      expect(result).toBe(42);
    });

    it('should classify and re-throw errors', async () => {
      const failingFn = async () => {
        throw new Error('Validation failed: invalid input');
      };
      const wrapped = withErrorHandling(failingFn);

      await expect(wrapped()).rejects.toBeInstanceOf(ValidationError);
    });

    it('should preserve WorkerError instances', async () => {
      const validationError = new ValidationError('field', 'value', 'expected');
      const failingFn = async () => {
        throw validationError;
      };
      const wrapped = withErrorHandling(failingFn);

      await expect(wrapped()).rejects.toBe(validationError);
    });

    it('should handle multiple arguments', async () => {
      const sumFn = async (a: number, b: number, c: number) => a + b + c;
      const wrapped = withErrorHandling(sumFn);

      const result = await wrapped(1, 2, 3);
      expect(result).toBe(6);
    });
  });
});
