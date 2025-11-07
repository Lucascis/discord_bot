/**
 * Integration Test: Redis Pub/Sub
 *
 * Purpose: Validates inter-service communication via Redis pub/sub
 * Scope: Tests message delivery, reliability, and error handling
 * Coverage: Gateway→Audio, Audio→Gateway, command routing, event broadcasting
 *
 * @group integration
 * @group redis
 * @group pubsub
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

// Test configuration
const TEST_TIMEOUT = 30000; // 30 seconds
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Pub/Sub channels
const CHANNELS = {
  COMMANDS: 'discord-bot:commands',
  TO_AUDIO: 'discord-bot:to-audio',
  TO_DISCORD: 'discord-bot:to-discord',
  UI_NOW: 'discord-bot:ui:now',
};

// Test fixtures
const TEST_GUILD_ID = '123456789012345678';
const TEST_USER_ID = '987654321098765432';

describe.skip('Integration: Redis Pub/Sub (requires Redis running)', () => {
  let publisher: Redis;
  let subscriber: Redis;
  let eventEmitter: EventEmitter;

  beforeAll(async () => {
    publisher = new Redis(REDIS_URL);
    subscriber = new Redis(REDIS_URL);
    eventEmitter = new EventEmitter();

    // Subscribe to all test channels
    await subscriber.subscribe(
      CHANNELS.COMMANDS,
      CHANNELS.TO_AUDIO,
      CHANNELS.TO_DISCORD,
      CHANNELS.UI_NOW
    );

    // Forward messages to event emitter for testing
    subscriber.on('message', (channel, message) => {
      eventEmitter.emit(channel, message);
    });
  });

  afterAll(async () => {
    await subscriber.unsubscribe();
    await publisher.quit();
    await subscriber.quit();
  });

  beforeEach(() => {
    eventEmitter.removeAllListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Command Channel (Gateway → Audio)', () => {
    it('should deliver play command from gateway to audio service', async () => {
      // Arrange
      const command = {
        type: 'play',
        guildId: TEST_GUILD_ID,
        channelId: 'channel-123',
        voiceChannelId: 'voice-456',
        query: 'https://youtube.com/watch?v=test',
        userId: TEST_USER_ID,
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('play');
      expect(parsed.guildId).toBe(TEST_GUILD_ID);
      expect(parsed.query).toBe('https://youtube.com/watch?v=test');
    }, TEST_TIMEOUT);

    it('should deliver skip command', async () => {
      // Arrange
      const command = {
        type: 'skip',
        guildId: TEST_GUILD_ID,
        channelId: 'channel-123',
        userId: TEST_USER_ID,
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('skip');
      expect(parsed.guildId).toBe(TEST_GUILD_ID);
    }, TEST_TIMEOUT);

    it('should deliver pause/resume commands', async () => {
      // Test pause
      const pauseCommand = {
        type: 'pause',
        guildId: TEST_GUILD_ID,
        channelId: 'channel-123',
        userId: TEST_USER_ID,
      };

      const pausePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(pauseCommand));
      const pauseReceived = await pausePromise;
      expect(JSON.parse(pauseReceived).type).toBe('pause');

      // Test resume
      const resumeCommand = {
        type: 'resume',
        guildId: TEST_GUILD_ID,
        channelId: 'channel-123',
        userId: TEST_USER_ID,
      };

      const resumePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(resumeCommand));
      const resumeReceived = await resumePromise;
      expect(JSON.parse(resumeReceived).type).toBe('resume');
    }, TEST_TIMEOUT);

    it('should handle queue manipulation commands', async () => {
      const commands = ['clear', 'shuffle', 'loop'];

      for (const commandType of commands) {
        const command = {
          type: commandType,
          guildId: TEST_GUILD_ID,
          channelId: 'channel-123',
          userId: TEST_USER_ID,
        };

        const messagePromise = new Promise<string>((resolve) => {
          eventEmitter.once(CHANNELS.COMMANDS, resolve);
        });

        await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));
        const received = await messagePromise;
        expect(JSON.parse(received).type).toBe(commandType);
      }
    }, TEST_TIMEOUT);
  });

  describe('Discord Events Channel (Gateway → Audio)', () => {
    it('should deliver VOICE_SERVER_UPDATE event', async () => {
      // Arrange
      const event = {
        type: 'VOICE_SERVER_UPDATE',
        guildId: TEST_GUILD_ID,
        endpoint: 'discord.gg',
        token: 'voice-token-12345',
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.TO_AUDIO, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.TO_AUDIO, JSON.stringify(event));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('VOICE_SERVER_UPDATE');
      expect(parsed.guildId).toBe(TEST_GUILD_ID);
      expect(parsed.token).toBe('voice-token-12345');
    }, TEST_TIMEOUT);

    it('should deliver VOICE_STATE_UPDATE event', async () => {
      // Arrange
      const event = {
        type: 'VOICE_STATE_UPDATE',
        guildId: TEST_GUILD_ID,
        userId: TEST_USER_ID,
        channelId: 'voice-channel-123',
        sessionId: 'session-12345',
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.TO_AUDIO, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.TO_AUDIO, JSON.stringify(event));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('VOICE_STATE_UPDATE');
      expect(parsed.sessionId).toBe('session-12345');
    }, TEST_TIMEOUT);

    it('should deliver guild availability events', async () => {
      const events = ['guildCreate', 'guildDelete', 'guildUnavailable'];

      for (const eventType of events) {
        const event = {
          type: eventType,
          guildId: TEST_GUILD_ID,
          timestamp: Date.now(),
        };

        const messagePromise = new Promise<string>((resolve) => {
          eventEmitter.once(CHANNELS.TO_AUDIO, resolve);
        });

        await publisher.publish(CHANNELS.TO_AUDIO, JSON.stringify(event));
        const received = await messagePromise;
        expect(JSON.parse(received).type).toBe(eventType);
      }
    }, TEST_TIMEOUT);
  });

  describe('Lavalink Events Channel (Audio → Gateway)', () => {
    it('should deliver track start event', async () => {
      // Arrange
      const event = {
        type: 'trackStart',
        guildId: TEST_GUILD_ID,
        track: {
          title: 'Test Song',
          author: 'Test Artist',
          duration: 180000,
          url: 'https://youtube.com/watch?v=test',
        },
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.TO_DISCORD, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.TO_DISCORD, JSON.stringify(event));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('trackStart');
      expect(parsed.track.title).toBe('Test Song');
    }, TEST_TIMEOUT);

    it('should deliver track end event', async () => {
      // Arrange
      const event = {
        type: 'trackEnd',
        guildId: TEST_GUILD_ID,
        reason: 'finished',
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.TO_DISCORD, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.TO_DISCORD, JSON.stringify(event));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('trackEnd');
      expect(parsed.reason).toBe('finished');
    }, TEST_TIMEOUT);

    it('should deliver track error event', async () => {
      // Arrange
      const event = {
        type: 'trackError',
        guildId: TEST_GUILD_ID,
        error: {
          message: 'Video unavailable',
          severity: 'common',
        },
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.TO_DISCORD, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.TO_DISCORD, JSON.stringify(event));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('trackError');
      expect(parsed.error.message).toBe('Video unavailable');
    }, TEST_TIMEOUT);

    it('should deliver player state change events', async () => {
      const events = ['playerPause', 'playerResume', 'playerDestroy'];

      for (const eventType of events) {
        const event = {
          type: eventType,
          guildId: TEST_GUILD_ID,
          timestamp: Date.now(),
        };

        const messagePromise = new Promise<string>((resolve) => {
          eventEmitter.once(CHANNELS.TO_DISCORD, resolve);
        });

        await publisher.publish(CHANNELS.TO_DISCORD, JSON.stringify(event));
        const received = await messagePromise;
        expect(JSON.parse(received).type).toBe(eventType);
      }
    }, TEST_TIMEOUT);
  });

  describe('UI Update Channel (Audio → Gateway)', () => {
    it('should deliver now playing UI update', async () => {
      // Arrange
      const uiUpdate = {
        type: 'nowPlaying',
        guildId: TEST_GUILD_ID,
        channelId: 'text-channel-123',
        track: {
          title: 'Current Song',
          author: 'Artist',
          duration: 200000,
          position: 30000, // 30 seconds in
          url: 'https://youtube.com/watch?v=current',
        },
        queue: {
          current: 0,
          total: 5,
        },
        isPaused: false,
        loopMode: 'off',
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.UI_NOW, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.UI_NOW, JSON.stringify(uiUpdate));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('nowPlaying');
      expect(parsed.track.title).toBe('Current Song');
      expect(parsed.queue.total).toBe(5);
      expect(parsed.isPaused).toBe(false);
    }, TEST_TIMEOUT);

    it('should deliver queue update UI', async () => {
      // Arrange
      const uiUpdate = {
        type: 'queueUpdate',
        guildId: TEST_GUILD_ID,
        channelId: 'text-channel-123',
        queue: [
          { position: 1, title: 'Song 1', author: 'Artist 1' },
          { position: 2, title: 'Song 2', author: 'Artist 2' },
          { position: 3, title: 'Song 3', author: 'Artist 3' },
        ],
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.UI_NOW, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.UI_NOW, JSON.stringify(uiUpdate));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.type).toBe('queueUpdate');
      expect(parsed.queue).toHaveLength(3);
    }, TEST_TIMEOUT);
  });

  describe('Message Delivery Guarantees', () => {
    it('should deliver messages in order', async () => {
      // Arrange
      const messageCount = 10;
      const receivedMessages: string[] = [];

      const allMessagesPromise = new Promise<void>((resolve) => {
        let count = 0;
        eventEmitter.on(CHANNELS.COMMANDS, (message) => {
          receivedMessages.push(message);
          count++;
          if (count === messageCount) resolve();
        });
      });

      // Act - Send messages sequentially
      for (let i = 0; i < messageCount; i++) {
        const command = {
          type: 'test',
          sequence: i,
          guildId: TEST_GUILD_ID,
        };
        await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));
      }

      await allMessagesPromise;

      // Assert - Verify order
      for (let i = 0; i < messageCount; i++) {
        const parsed = JSON.parse(receivedMessages[i]);
        expect(parsed.sequence).toBe(i);
      }
    }, TEST_TIMEOUT);

    it('should handle rapid message bursts', async () => {
      // Arrange
      const burstSize = 100;
      const receivedCount = { value: 0 };

      const allMessagesPromise = new Promise<void>((resolve) => {
        eventEmitter.on(CHANNELS.COMMANDS, () => {
          receivedCount.value++;
          if (receivedCount.value === burstSize) resolve();
        });
      });

      // Act - Send messages in rapid succession
      const sendPromises = [];
      for (let i = 0; i < burstSize; i++) {
        const command = {
          type: 'burst-test',
          index: i,
          guildId: TEST_GUILD_ID,
        };
        sendPromises.push(
          publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command))
        );
      }

      await Promise.all(sendPromises);
      await allMessagesPromise;

      // Assert
      expect(receivedCount.value).toBe(burstSize);
    }, TEST_TIMEOUT);

    it('should handle large message payloads', async () => {
      // Arrange - Create large queue payload
      const largeQueue = Array.from({ length: 100 }, (_, i) => ({
        position: i,
        title: `Song ${i}`.repeat(10), // ~100 bytes per title
        author: `Artist ${i}`,
        url: `https://youtube.com/watch?v=test${i}`,
        duration: 180000,
      }));

      const command = {
        type: 'queue-sync',
        guildId: TEST_GUILD_ID,
        queue: largeQueue,
        timestamp: Date.now(),
      };

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));

      // Assert
      const received = await messagePromise;
      const parsed = JSON.parse(received);

      expect(parsed.queue).toHaveLength(100);
      expect(parsed.type).toBe('queue-sync');
    }, TEST_TIMEOUT);
  });

  describe('Error Handling and Resilience', () => {
    it('should handle malformed JSON gracefully', async () => {
      // Arrange
      const malformedMessage = '{ "type": "test", "invalid": ';

      const messagePromise = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      // Act
      await publisher.publish(CHANNELS.COMMANDS, malformedMessage);

      // Assert - Subscriber should receive it (parsing is consumer's responsibility)
      const received = await messagePromise;
      expect(received).toBe(malformedMessage);

      // Consumer would handle parse error
      expect(() => JSON.parse(received)).toThrow();
    }, TEST_TIMEOUT);

    it('should handle subscription reconnection', async () => {
      // Arrange - Create new subscriber
      const tempSubscriber = new Redis(REDIS_URL);
      await tempSubscriber.subscribe(CHANNELS.COMMANDS);

      const messagePromise = new Promise<string>((resolve) => {
        tempSubscriber.on('message', (channel, message) => {
          if (channel === CHANNELS.COMMANDS) resolve(message);
        });
      });

      // Act - Disconnect and reconnect
      await tempSubscriber.disconnect();
      await tempSubscriber.connect();
      await tempSubscriber.subscribe(CHANNELS.COMMANDS);

      const command = {
        type: 'reconnect-test',
        guildId: TEST_GUILD_ID,
      };

      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));

      // Assert
      const received = await messagePromise;
      expect(JSON.parse(received).type).toBe('reconnect-test');

      await tempSubscriber.quit();
    }, TEST_TIMEOUT);

    it('should handle multiple subscribers on same channel', async () => {
      // Arrange - Create additional subscribers
      const subscriber2 = new Redis(REDIS_URL);
      const subscriber3 = new Redis(REDIS_URL);

      await subscriber2.subscribe(CHANNELS.COMMANDS);
      await subscriber3.subscribe(CHANNELS.COMMANDS);

      const received1 = new Promise<string>((resolve) => {
        eventEmitter.once(CHANNELS.COMMANDS, resolve);
      });

      const received2 = new Promise<string>((resolve) => {
        subscriber2.once('message', (_, message) => resolve(message));
      });

      const received3 = new Promise<string>((resolve) => {
        subscriber3.once('message', (_, message) => resolve(message));
      });

      // Act
      const command = {
        type: 'broadcast-test',
        guildId: TEST_GUILD_ID,
      };

      await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));

      // Assert - All subscribers receive the message
      const [msg1, msg2, msg3] = await Promise.all([received1, received2, received3]);

      expect(JSON.parse(msg1).type).toBe('broadcast-test');
      expect(JSON.parse(msg2).type).toBe('broadcast-test');
      expect(JSON.parse(msg3).type).toBe('broadcast-test');

      await subscriber2.quit();
      await subscriber3.quit();
    }, TEST_TIMEOUT);
  });

  describe('Performance and Latency', () => {
    it('should deliver messages with low latency', async () => {
      // Arrange
      const iterations = 100;
      const latencies: number[] = [];

      // Act
      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();

        const messagePromise = new Promise<void>((resolve) => {
          eventEmitter.once(CHANNELS.COMMANDS, () => {
            latencies.push(performance.now() - startTime);
            resolve();
          });
        });

        const command = {
          type: 'latency-test',
          index: i,
          timestamp: Date.now(),
        };

        await publisher.publish(CHANNELS.COMMANDS, JSON.stringify(command));
        await messagePromise;
      }

      // Assert
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      expect(avgLatency).toBeLessThan(10); // Average < 10ms
      expect(maxLatency).toBeLessThan(50); // Max < 50ms

      console.log('Redis Pub/Sub Latency:', {
        avg: avgLatency.toFixed(2) + 'ms',
        max: maxLatency.toFixed(2) + 'ms',
        min: Math.min(...latencies).toFixed(2) + 'ms',
      });
    }, TEST_TIMEOUT);
  });
});
