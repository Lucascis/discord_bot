import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AppError,
  ValidationError,
  RateLimitError,
  DiscordError,
  CircuitBreaker,
  withErrorHandling,
  withRetry,
  handleInteractionError
} from '../src/errors.js';

// Mock the logger
vi.mock('@discord-bot/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

describe('errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Error Classes', () => {
    describe('AppError', () => {
      it('should create error with correct properties', () => {
        const error = new AppError('Test message', 'TEST_CODE', 400);
        
        expect(error.message).toBe('Test message');
        expect(error.code).toBe('TEST_CODE');
        expect(error.statusCode).toBe(400);
        expect(error.isOperational).toBe(true);
        expect(error.name).toBe('AppError');
      });

      it('should default to 500 status code and operational true', () => {
        const error = new AppError('Test', 'TEST');
        expect(error.statusCode).toBe(500);
        expect(error.isOperational).toBe(true);
      });
    });

    describe('ValidationError', () => {
      it('should create validation error with field', () => {
        const error = new ValidationError('Invalid value', 'username');
        
        expect(error.message).toBe('username: Invalid value');
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.statusCode).toBe(400);
        expect(error.name).toBe('ValidationError');
      });

      it('should create validation error without field', () => {
        const error = new ValidationError('Invalid input');
        expect(error.message).toBe('Invalid input');
      });
    });

    describe('RateLimitError', () => {
      it('should create rate limit error with default message', () => {
        const error = new RateLimitError();
        
        expect(error.message).toBe('Rate limit exceeded');
        expect(error.code).toBe('RATE_LIMIT');
        expect(error.statusCode).toBe(429);
      });

      it('should accept custom message', () => {
        const error = new RateLimitError('Custom rate limit message');
        expect(error.message).toBe('Custom rate limit message');
      });
    });

    describe('DiscordError', () => {
      it('should create Discord error with default message', () => {
        const error = new DiscordError();
        
        expect(error.message).toBe('Discord API error');
        expect(error.code).toBe('DISCORD_ERROR');
        expect(error.statusCode).toBe(502);
      });

      it('should accept custom message', () => {
        const error = new DiscordError('Custom Discord error');
        expect(error.message).toBe('Custom Discord error');
      });
    });
  });

  describe('CircuitBreaker', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should allow requests when circuit is closed', async () => {
      const breaker = new CircuitBreaker('test', 3, 5000);
      const mockFn = vi.fn().mockResolvedValue('success');

      const result = await breaker.execute(mockFn);
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('should count failures and open circuit', async () => {
      const breaker = new CircuitBreaker('test', 2, 5000);
      const mockFn = vi.fn().mockRejectedValue(new Error('failure'));

      // First failure
      await expect(breaker.execute(mockFn)).rejects.toThrow('failure');
      expect(breaker.getStats().state).toBe('closed');

      // Second failure - should open circuit
      await expect(breaker.execute(mockFn)).rejects.toThrow('failure');
      expect(breaker.getStats().state).toBe('open');

      // Third call should be rejected immediately
      const thirdCall = breaker.execute(mockFn);
      await expect(thirdCall).rejects.toThrow('Circuit breaker is open');
      expect(mockFn).toHaveBeenCalledTimes(2); // Should not call the function
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker('test', 1, 1000);
      const mockFn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger failure to open circuit
      await expect(breaker.execute(mockFn)).rejects.toThrow('failure');
      expect(breaker.getStats().state).toBe('open');

      // Advance time to trigger half-open state
      vi.advanceTimersByTime(1100);

      // Reset mock to succeed
      mockFn.mockResolvedValueOnce('recovery success');
      
      const result = await breaker.execute(mockFn);
      expect(result).toBe('recovery success');
      expect(breaker.getStats().state).toBe('closed');
    });

    it('should provide correct statistics', () => {
      const breaker = new CircuitBreaker('test-stats', 5, 10000);
      const stats = breaker.getStats();

      expect(stats.name).toBe('test-stats');
      expect(stats.state).toBe('closed');
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.requests).toBe(0);
      expect(stats.threshold).toBe(5);
    });
  });

  describe('withErrorHandling', () => {
    it('should execute function successfully', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(mockFn, 'test_operation');

      const result = await wrapped();
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('should handle and log errors', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('test error'));
      const wrapped = withErrorHandling(mockFn, 'test_operation');

      await expect(wrapped()).rejects.toThrow('test error');
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('should pass through function arguments', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(mockFn, 'test_operation');

      await wrapped('arg1', 42, { key: 'value' });
      expect(mockFn).toHaveBeenCalledWith('arg1', 42, { key: 'value' });
    });
  });

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(mockFn, 3, 1000);
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockFn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(mockFn, 3, 1); // Use very small delay
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retries', async () => {
      const mockFn = vi.fn().mockRejectedValue(new Error('persistent failure'));
      
      await expect(withRetry(mockFn, 2, 1)).rejects.toThrow('persistent failure'); // Use very small delay
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors', async () => {
      const validationError = new ValidationError('Invalid input');
      const mockFn = vi.fn().mockRejectedValue(validationError);

      await expect(withRetry(mockFn, 3, 100)).rejects.toThrow('Invalid input');
      expect(mockFn).toHaveBeenCalledOnce();
    });
  });

  describe('handleInteractionError', () => {
    it('should handle interaction errors gracefully', async () => {
      const mockInteraction = {
        replied: false,
        deferred: false,
        type: 2, // ChatInputCommand
        user: { id: 'user123' },
        guildId: 'guild123',
        channelId: 'channel123',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        isChatInputCommand: vi.fn().mockReturnValue(true),
        isButton: vi.fn().mockReturnValue(false)
      };

      const error = new ValidationError('Invalid command');
      
      await handleInteractionError(error, mockInteraction as any, 'test_context');
      
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Invalid command'),
          ephemeral: true
        })
      );
    });

    it('should use followUp for already replied interactions', async () => {
      const mockInteraction = {
        replied: true,
        deferred: false,
        type: 2,
        user: { id: 'user123' },
        guildId: 'guild123',
        channelId: 'channel123',
        reply: vi.fn(),
        followUp: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(),
        isChatInputCommand: vi.fn().mockReturnValue(true),
        isButton: vi.fn().mockReturnValue(false)
      };

      const error = new Error('Generic error');
      
      await handleInteractionError(error, mockInteraction as any);
      
      expect(mockInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
          ephemeral: true
        })
      );
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should use editReply for deferred interactions', async () => {
      const mockInteraction = {
        replied: false,
        deferred: true,
        type: 2,
        user: { id: 'user123' },
        guildId: 'guild123',
        channelId: 'channel123',
        reply: vi.fn(),
        followUp: vi.fn(),
        editReply: vi.fn().mockResolvedValue(undefined),
        isChatInputCommand: vi.fn().mockReturnValue(true),
        isButton: vi.fn().mockReturnValue(false)
      };

      const error = new RateLimitError();
      
      await handleInteractionError(error, mockInteraction as any);
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('You\'re doing that too often'),
        })
      );
    });
  });
});