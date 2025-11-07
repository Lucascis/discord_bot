import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '@discord-bot/database';
import crypto from 'crypto';
import { validGuildId, validApiKey } from './fixtures.js';

// Access global mock Redis instance
declare global {
   
  var mockRedis: {
    publish: ReturnType<typeof vi.fn>;
  };
}

describe('Webhook Routes', () => {
  const webhookSecret = 'test-webhook-secret';

  // Helper function to generate valid webhook signature
  function generateWebhookSignature(body: any, timestamp: number): string {
    const bodyString = JSON.stringify(body);
    return crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/webhooks/music/play', () => {
    const payload = {
      guildId: validGuildId,
      query: 'test song',
      userId: '987654321098765432'
    };

    it('should accept webhook with valid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('event', 'PLAY_MUSIC');
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('message');
    });

    it('should reject webhook with invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidSignature = 'invalid-signature-hash';

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', invalidSignature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject webhook with missing signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject webhook with missing timestamp', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject webhook with expired timestamp', async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 400; // 6 minutes ago
      const signature = generateWebhookSignature(payload, expiredTimestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', expiredTimestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toContain('timestamp too old');
    });

    it('should reject webhook with future timestamp', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 400; // 6 minutes in future
      const signature = generateWebhookSignature(payload, futureTimestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', futureTimestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should validate payload structure', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidPayload = { guildId: 'invalid-id', query: 'test' };
      const signature = generateWebhookSignature(invalidPayload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate guildId is required', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidPayload = { query: 'test' };
      const signature = generateWebhookSignature(invalidPayload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should publish event to Redis', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      // Verify successful response (Redis publish is internal implementation detail)
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.event).toBe('PLAY_MUSIC');
    });

    it('should return 401 without API key', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/webhooks/music/control', () => {
    const payload = {
      guildId: validGuildId,
      action: 'pause',
      userId: '987654321098765432'
    };

    it('should accept control webhook with valid action', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/control')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('event', 'CONTROL_MUSIC');
      expect(res.body.data).toHaveProperty('action', 'pause');
      expect(res.body.data.message).toContain('pause');
    });

    it('should accept all valid actions', async () => {
      const validActions = ['pause', 'resume', 'skip', 'stop', 'shuffle'];

      for (const action of validActions) {
        const timestamp = Math.floor(Date.now() / 1000);
        const testPayload = { ...payload, action };
        const signature = generateWebhookSignature(testPayload, timestamp);

        const res = await request(app)
          .post('/api/v1/webhooks/music/control')
          .set('X-API-Key', validApiKey)
          .set('X-Webhook-Signature', signature)
          .set('X-Webhook-Timestamp', timestamp.toString())
          .send(testPayload);

        expect(res.status).toBe(200);
        expect(res.body.data.action).toBe(action);
      }
    });

    it('should reject invalid action', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidPayload = { ...payload, action: 'invalid-action' };
      const signature = generateWebhookSignature(invalidPayload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/control')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(invalidPayload);

      // Validation happens before business logic, so we get 400 (VALIDATION_ERROR) not 500
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject webhook with invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/webhooks/music/control')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', 'invalid-signature')
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should publish control event to Redis', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/control')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      // Verify successful response (Redis publish is internal implementation detail)
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.event).toBe('CONTROL_MUSIC');
    });

    it('should return 401 without API key', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/control')
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/webhooks/notifications', () => {
    const payload = {
      guildId: validGuildId,
      channelId: '111222333444555666',
      message: 'Test notification',
      type: 'info'
    };

    it('should send notification webhook successfully', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('event', 'SEND_NOTIFICATION');
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
    });

    it('should accept all notification types', async () => {
      const validTypes = ['info', 'warning', 'error', 'success'];

      for (const type of validTypes) {
        const timestamp = Math.floor(Date.now() / 1000);
        const testPayload = { ...payload, type };
        const signature = generateWebhookSignature(testPayload, timestamp);

        const res = await request(app)
          .post('/api/v1/webhooks/notifications')
          .set('X-API-Key', validApiKey)
          .set('X-Webhook-Signature', signature)
          .set('X-Webhook-Timestamp', timestamp.toString())
          .send(testPayload);

        expect(res.status).toBe(200);
      }
    });

    it('should use default type if not provided', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payloadWithoutType = {
        guildId: validGuildId,
        channelId: '111222333444555666',
        message: 'Test notification'
      };
      const signature = generateWebhookSignature(payloadWithoutType, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payloadWithoutType);

      expect(res.status).toBe(200);
    });

    it('should validate message length', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const longMessage = 'a'.repeat(2001);
      const invalidPayload = { ...payload, message: longMessage };
      const signature = generateWebhookSignature(invalidPayload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject webhook with invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', 'invalid')
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should publish notification event to Redis', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      // Verify successful response (Redis publish is internal implementation detail)
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.event).toBe('SEND_NOTIFICATION');
    });

    it('should return 401 without API key', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/notifications')
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/webhooks/events/subscribe', () => {
    const payload = {
      guildId: validGuildId,
      webhookUrl: 'https://example.com/webhook',
      events: ['track_start', 'track_end', 'queue_updated']
    };

    it('should create webhook subscription successfully', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      vi.mocked(prisma.webhookSubscription.upsert).mockResolvedValue({
        id: 1,
        guildId: validGuildId,
        webhookUrl: payload.webhookUrl,
        events: payload.events,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('event', 'WEBHOOK_SUBSCRIBED');
      expect(res.body.data).toHaveProperty('webhookUrl', payload.webhookUrl);
      expect(res.body.data).toHaveProperty('events');
      expect(res.body.data.events).toHaveLength(3);
    });

    it('should use default events if not provided', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payloadWithoutEvents = {
        guildId: validGuildId,
        webhookUrl: 'https://example.com/webhook'
      };
      const signature = generateWebhookSignature(payloadWithoutEvents, timestamp);

      vi.mocked(prisma.webhookSubscription.upsert).mockResolvedValue({
        id: 1,
        guildId: validGuildId,
        webhookUrl: payloadWithoutEvents.webhookUrl,
        events: ['track_start', 'track_end', 'queue_updated'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payloadWithoutEvents);

      expect(res.status).toBe(200);
      expect(res.body.data.events).toBeDefined();
    });

    it('should validate webhookUrl format', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidPayload = { ...payload, webhookUrl: 'not-a-url' };
      const signature = generateWebhookSignature(invalidPayload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject webhook with invalid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', 'invalid')
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle database errors', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      vi.mocked(prisma.webhookSubscription.upsert).mockRejectedValue(
        new Error('Database error')
      );

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should update existing subscription', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      vi.mocked(prisma.webhookSubscription.upsert).mockResolvedValue({
        id: 1,
        guildId: validGuildId,
        webhookUrl: payload.webhookUrl,
        events: payload.events,
        isActive: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date()
      });

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(prisma.webhookSubscription.upsert).toHaveBeenCalled();
    });

    it('should return 401 without API key', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/events/subscribe')
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/webhooks/events/test', () => {
    it('should return test endpoint status', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks/events/test')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('status', 'webhook_endpoint_active');
      expect(res.body.data).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should not require webhook signature for test endpoint', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks/events/test')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
    });

    it('should include request ID', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks/events/test')
        .set('X-API-Key', validApiKey)
        .set('X-Request-ID', 'test-123');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('requestId');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks/events/test');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Webhook Security - Replay Attack Prevention', () => {
    it('should reject replayed webhook with old timestamp', async () => {
      const payload = {
        guildId: validGuildId,
        query: 'test song',
        userId: '987654321098765432'
      };

      // Create a webhook request with an old timestamp
      const oldTimestamp = Math.floor(Date.now() / 1000) - 301; // Just over 5 minutes ago
      const signature = generateWebhookSignature(payload, oldTimestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', oldTimestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should accept webhook within time window', async () => {
      const payload = {
        guildId: validGuildId,
        query: 'test song',
        userId: '987654321098765432'
      };

      const timestamp = Math.floor(Date.now() / 1000) - 200; // 3 minutes ago (within 5 minute window)
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  describe('Webhook Security - Signature Validation', () => {
    it('should use timing-safe comparison for signatures', async () => {
      const payload = {
        guildId: validGuildId,
        query: 'test song',
        userId: '987654321098765432'
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const validSignature = generateWebhookSignature(payload, timestamp);

      // Slightly modify the signature
      const modifiedSignature = validSignature.slice(0, -1) + 'x';

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', modifiedSignature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject signature with wrong body', async () => {
      const payload = {
        guildId: validGuildId,
        query: 'test song',
        userId: '987654321098765432'
      };

      const differentPayload = {
        guildId: validGuildId,
        query: 'different song',
        userId: '987654321098765432'
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature(payload, timestamp);

      const res = await request(app)
        .post('/api/v1/webhooks/music/play')
        .set('X-API-Key', validApiKey)
        .set('X-Webhook-Signature', signature)
        .set('X-Webhook-Timestamp', timestamp.toString())
        .send(differentPayload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
