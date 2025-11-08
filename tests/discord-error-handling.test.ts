import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeDiscordOperation } from '../gateway/src/errors.js';

// Mock the logger
vi.mock('@discord-bot/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock prom-client with proper constructor
vi.mock('prom-client', () => {
  const mockCounter = vi.fn(function(this: any) {
    this.labels = vi.fn(() => ({
      inc: vi.fn()
    }));
    return this;
  });

  return {
    Counter: mockCounter,
    register: {
      registerMetric: vi.fn()
    }
  };
});

describe('Discord API Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('safeDiscordOperation', () => {
    it('should return result on successful operation', async () => {
      const mockOperation = vi.fn().mockResolvedValue('success');

      const result = await safeDiscordOperation(
        mockOperation,
        'test-operation'
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle Unknown Message error (10008) without retries', async () => {
      const discordError = {
        name: 'DiscordAPIError',
        code: 10008,
        message: 'Unknown Message'
      };

      const mockOperation = vi.fn().mockRejectedValue(discordError);
      const mockFallback = vi.fn().mockResolvedValue('fallback-result');

      const result = await safeDiscordOperation(
        mockOperation,
        'edit-message-test',
        {
          maxRetries: 2,
          fallback: mockFallback
        }
      );

      expect(result).toBe('fallback-result');
      expect(mockOperation).toHaveBeenCalledTimes(1); // No retries for 10008
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should retry on rate limit error (20028) with exponential backoff', async () => {
      const rateLimitError = {
        name: 'DiscordAPIError',
        code: 20028,
        message: 'Rate limited'
      };

      const mockOperation = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue('success-after-retry');

      const startTime = Date.now();
      const result = await safeDiscordOperation(
        mockOperation,
        'rate-limit-test',
        { maxRetries: 2 }
      );
      const duration = Date.now() - startTime;

      expect(result).toBe('success-after-retry');
      expect(mockOperation).toHaveBeenCalledTimes(3);
      expect(duration).toBeGreaterThan(500); // Should have delays
    });

    it('should handle Missing Permissions error (50013) without retries', async () => {
      const permissionError = {
        name: 'DiscordAPIError',
        code: 50013,
        message: 'Missing Permissions'
      };

      const mockOperation = vi.fn().mockRejectedValue(permissionError);
      const mockOnError = vi.fn();

      const result = await safeDiscordOperation(
        mockOperation,
        'permission-test',
        {
          maxRetries: 2,
          onError: mockOnError
        }
      );

      expect(result).toBeNull();
      expect(mockOperation).toHaveBeenCalledTimes(1); // No retries for 50013
      expect(mockOnError).toHaveBeenCalledWith(permissionError);
    });

    it('should retry on API Overloaded error (130000)', async () => {
      const overloadError = {
        name: 'DiscordAPIError',
        code: 130000,
        message: 'API Overloaded'
      };

      const mockOperation = vi.fn()
        .mockRejectedValueOnce(overloadError)
        .mockResolvedValue('success-after-retry');

      const result = await safeDiscordOperation(
        mockOperation,
        'overload-test',
        { maxRetries: 2 }
      );

      expect(result).toBe('success-after-retry');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should retry on unknown network errors', async () => {
      const networkError = new Error('ECONNRESET');

      const mockOperation = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue('success-after-retry');

      const result = await safeDiscordOperation(
        mockOperation,
        'network-test',
        { maxRetries: 2 }
      );

      expect(result).toBe('success-after-retry');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should execute fallback when all retries fail', async () => {
      const persistentError = {
        name: 'DiscordAPIError',
        code: 130000,
        message: 'Persistent API error'
      };

      const mockOperation = vi.fn().mockRejectedValue(persistentError);
      const mockFallback = vi.fn().mockResolvedValue('fallback-success');

      const result = await safeDiscordOperation(
        mockOperation,
        'fallback-test',
        {
          maxRetries: 2,
          fallback: mockFallback
        }
      );

      expect(result).toBe('fallback-success');
      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should return null when no fallback is available and all retries fail', async () => {
      const persistentError = new Error('Persistent error');

      const mockOperation = vi.fn().mockRejectedValue(persistentError);

      const result = await safeDiscordOperation(
        mockOperation,
        'no-fallback-test',
        { maxRetries: 1 }
      );

      expect(result).toBeNull();
      expect(mockOperation).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it('should handle fallback failure gracefully', async () => {
      const primaryError = new Error('Primary operation failed');
      const fallbackError = new Error('Fallback also failed');

      const mockOperation = vi.fn().mockRejectedValue(primaryError);
      const mockFallback = vi.fn().mockRejectedValue(fallbackError);

      const result = await safeDiscordOperation(
        mockOperation,
        'fallback-failure-test',
        {
          maxRetries: 0,
          fallback: mockFallback
        }
      );

      expect(result).toBeNull();
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Classification', () => {
    const testCases = [
      { code: 10003, name: 'Unknown Channel', shouldRetry: false },
      { code: 10008, name: 'Unknown Message', shouldRetry: false },
      { code: 10013, name: 'Unknown User', shouldRetry: false },
      { code: 50001, name: 'Missing Access', shouldRetry: false },
      { code: 50013, name: 'Missing Permissions', shouldRetry: false },
      { code: 50035, name: 'Invalid Form Body', shouldRetry: false },
      { code: 20028, name: 'Rate Limited', shouldRetry: true },
      { code: 130000, name: 'API Overloaded', shouldRetry: true }
    ];

    testCases.forEach(({ code, name, shouldRetry }) => {
      it(`should ${shouldRetry ? 'retry' : 'not retry'} ${name} (${code})`, async () => {
        const discordError = {
          name: 'DiscordAPIError',
          code,
          message: name
        };

        const mockOperation = vi.fn().mockRejectedValue(discordError);

        await safeDiscordOperation(
          mockOperation,
          `test-${code}`,
          { maxRetries: 2 }
        );

        if (shouldRetry) {
          expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
        } else {
          expect(mockOperation).toHaveBeenCalledTimes(1); // No retries
        }
      });
    });
  });

  describe('Delay Behavior', () => {
    it('should use longer delays for rate limit errors', async () => {
      const rateLimitError = {
        name: 'DiscordAPIError',
        code: 20028,
        message: 'Rate limited'
      };

      const mockOperation = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue('success');

      const startTime = Date.now();
      await safeDiscordOperation(
        mockOperation,
        'rate-limit-delay-test',
        { maxRetries: 1 }
      );
      const duration = Date.now() - startTime;

      // Should have at least 2000ms delay for rate limit (2000 * attempt)
      expect(duration).toBeGreaterThanOrEqual(2000);
    });

    it('should use shorter delays for other retryable errors', async () => {
      const overloadError = {
        name: 'DiscordAPIError',
        code: 130000,
        message: 'API Overloaded'
      };

      const mockOperation = vi.fn()
        .mockRejectedValueOnce(overloadError)
        .mockResolvedValue('success');

      const startTime = Date.now();
      await safeDiscordOperation(
        mockOperation,
        'overload-delay-test',
        { maxRetries: 1 }
      );
      const duration = Date.now() - startTime;

      // Should have 500ms delay for non-rate-limit errors (500 * attempt)
      // Allow 10ms tolerance for timing variations across environments
      expect(duration).toBeGreaterThanOrEqual(490);
      expect(duration).toBeLessThan(2000);
    });
  });
});