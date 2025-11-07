/**
 * Mock implementation of ioredis for testing
 *
 * This mock is automatically used by Vitest when any module imports 'ioredis'.
 * It provides a complete Redis client implementation that works in-memory.
 *
 * @see https://vitest.dev/guide/mocking.html#modules
 */

import { vi } from 'vitest';

/**
 * Global registry for mock responses
 * Tests can set expected responses using setMockRedisResponse()
 */
const globalMockResponseRegistry = new Map<string, unknown>();

/**
 * Mock Redis client class
 * Implements all commonly used Redis methods with in-memory storage
 */
class MockRedis {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private subscriptions = new Set<string>();
  private storage = new Map<string, string>();
  public status: string = 'ready';

  constructor(_url?: string) {
    // Constructor accepts URL but ignores it (no real connection)
  }

  // ============================================
  // Connection Management
  // ============================================

  connect = vi.fn().mockResolvedValue(undefined);
  disconnect = vi.fn().mockResolvedValue(undefined);
  quit = vi.fn().mockResolvedValue('OK');
  ping = vi.fn().mockResolvedValue('PONG');

  // ============================================
  // Key-Value Operations
  // ============================================

  get = vi.fn().mockImplementation(async (key: string) => {
    return this.storage.get(key) || null;
  });

  set = vi.fn().mockImplementation(async (key: string, value: string) => {
    this.storage.set(key, value);
    return 'OK';
  });

  del = vi.fn().mockImplementation(async (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      if (this.storage.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  });

  exists = vi.fn().mockImplementation(async (...keys: string[]) => {
    let count = 0;
    for (const key of keys) {
      if (this.storage.has(key)) {
        count++;
      }
    }
    return count;
  });

  incr = vi.fn().mockResolvedValue(1);
  decr = vi.fn().mockResolvedValue(-1);
  incrby = vi.fn().mockResolvedValue(1);
  decrby = vi.fn().mockResolvedValue(-1);

  // ============================================
  // Expiration
  // ============================================

  expire = vi.fn().mockResolvedValue(1);
  expireat = vi.fn().mockResolvedValue(1);
  ttl = vi.fn().mockResolvedValue(-1);
  pttl = vi.fn().mockResolvedValue(-1);
  persist = vi.fn().mockResolvedValue(1);

  // ============================================
  // Pub/Sub
  // ============================================

  /**
   * Publish a message to a channel
   * Automatically triggers mock responses for audio/search/analytics/guild requests
   */
  publish = vi.fn().mockImplementation(async (channel: string, message: string) => {
    try {
      const request = JSON.parse(message);
      const requestType = request.type;
      const requestId = request.requestId;

      const mockResponse = globalMockResponseRegistry.get(requestType);

      if (mockResponse && requestId) {
        // Determine response channel based on request channel
        let responseChannel = `audio-response:${requestId}`;
        if (channel.includes('search-request')) {
          responseChannel = `search-response:${requestId}`;
        } else if (channel.includes('analytics-request')) {
          responseChannel = `analytics-response:${requestId}`;
        } else if (channel.includes('guild-request')) {
          responseChannel = `guild-response:${requestId}`;
        }

        // Simulate async response
        setImmediate(() => {
          const handlers = this.listeners.get('message');
          if (handlers) {
            handlers.forEach(handler => {
              handler(responseChannel, JSON.stringify(mockResponse));
            });
          }
        });
      }
    } catch {
      // Ignore invalid JSON
    }

    return 1; // Number of subscribers that received the message
  });

  subscribe = vi.fn().mockImplementation((channel: string | string[], callback?: (...args: unknown[]) => void) => {
    const channels = Array.isArray(channel) ? channel : [channel];
    channels.forEach(ch => this.subscriptions.add(ch));
    if (callback) setImmediate(() => callback(null));
    return Promise.resolve(channels.length);
  });

  unsubscribe = vi.fn().mockImplementation((channel?: string | string[], callback?: (...args: unknown[]) => void) => {
    if (channel) {
      const channels = Array.isArray(channel) ? channel : [channel];
      channels.forEach(ch => this.subscriptions.delete(ch));
    } else {
      this.subscriptions.clear();
    }
    if (callback) setImmediate(() => callback(null));
    return Promise.resolve(this.subscriptions.size);
  });

  psubscribe = vi.fn().mockResolvedValue(1);
  punsubscribe = vi.fn().mockResolvedValue(1);

  // ============================================
  // Event Emitter
  // ============================================

  on = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  });

  once = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    const wrappedHandler = (...args: unknown[]) => {
      handler(...args);
      this.listeners.get(event)?.delete(wrappedHandler);
    };
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(wrappedHandler);
    return this;
  });

  off = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    this.listeners.get(event)?.delete(handler);
    return this;
  });

  removeListener = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    this.listeners.get(event)?.delete(handler);
    return this;
  });

  removeAllListeners = vi.fn().mockImplementation((event?: string) => {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  });

  emit = vi.fn();

  // ============================================
  // Hash Operations
  // ============================================

  hget = vi.fn().mockResolvedValue(null);
  hset = vi.fn().mockResolvedValue(1);
  hdel = vi.fn().mockResolvedValue(1);
  hgetall = vi.fn().mockResolvedValue({});
  hkeys = vi.fn().mockResolvedValue([]);
  hvals = vi.fn().mockResolvedValue([]);
  hexists = vi.fn().mockResolvedValue(0);
  hincrby = vi.fn().mockResolvedValue(1);
  hlen = vi.fn().mockResolvedValue(0);

  // ============================================
  // List Operations
  // ============================================

  lpush = vi.fn().mockResolvedValue(1);
  rpush = vi.fn().mockResolvedValue(1);
  lpop = vi.fn().mockResolvedValue(null);
  rpop = vi.fn().mockResolvedValue(null);
  lrange = vi.fn().mockResolvedValue([]);
  llen = vi.fn().mockResolvedValue(0);
  lindex = vi.fn().mockResolvedValue(null);

  // ============================================
  // Set Operations
  // ============================================

  sadd = vi.fn().mockResolvedValue(1);
  srem = vi.fn().mockResolvedValue(1);
  smembers = vi.fn().mockResolvedValue([]);
  sismember = vi.fn().mockResolvedValue(0);
  scard = vi.fn().mockResolvedValue(0);

  // ============================================
  // Sorted Set Operations
  // ============================================

  zadd = vi.fn().mockResolvedValue(1);
  zrem = vi.fn().mockResolvedValue(1);
  zrange = vi.fn().mockResolvedValue([]);
  zcard = vi.fn().mockResolvedValue(0);
  zscore = vi.fn().mockResolvedValue(null);

  // ============================================
  // Transaction Support
  // ============================================

  multi = vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
  });

  // ============================================
  // Pipeline Support
  // ============================================

  pipeline = vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
  });

  // ============================================
  // Utility Methods
  // ============================================

  keys = vi.fn().mockResolvedValue([]);
  scan = vi.fn().mockResolvedValue(['0', []]);
  flushdb = vi.fn().mockResolvedValue('OK');
  flushall = vi.fn().mockResolvedValue('OK');
  dbsize = vi.fn().mockResolvedValue(0);
  info = vi.fn().mockResolvedValue('redis_version:7.0.0\r\n');
  time = vi.fn().mockResolvedValue(['1234567890', '123456']);

  // ============================================
  // Cleanup Methods
  // ============================================

  clearStorage() {
    this.storage.clear();
  }

  clearListeners() {
    this.listeners.clear();
  }

  clearSubscriptions() {
    this.subscriptions.clear();
  }
}

// ============================================
// Global Test Helpers
// ============================================

/**
 * Set a mock response for a specific request type
 * This will be returned when a request is published to Redis
 *
 * @example
 * setMockRedisResponse('PLAY_TRACK', { success: true, track: {...} });
 */
export function setMockRedisResponse(requestType: string, response: unknown): void {
  globalMockResponseRegistry.set(requestType, response);
}

/**
 * Clear all mock responses
 * Should be called in beforeEach/afterEach hooks
 */
export function clearMockRedisResponses(): void {
  globalMockResponseRegistry.clear();
}

// ============================================
// Export Mock Class as Default
// ============================================

export default MockRedis;

/**
 * Named export for Cluster (not commonly used in this project)
 */
export class Cluster extends MockRedis {
  constructor(..._args: unknown[]) {
    super();
  }
}

/**
 * Export Command class for compatibility
 */
export class Command {
  name: string;
  args: unknown[];

  constructor(name: string, args: unknown[]) {
    this.name = name;
    this.args = args;
  }
}
