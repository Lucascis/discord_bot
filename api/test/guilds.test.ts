import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '@discord-bot/database';
import { mockGuild, validGuildId, validApiKey } from './fixtures.js';

describe('Guild Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/guilds', () => {
    it('should return paginated guild list', async () => {
      // Configure mock response for guild list
      (global as any).setMockRedisResponse('GUILD_LIST', {
        data: {
          guilds: [mockGuild],
          total: 1
        }
      });

      const res = await request(app)
        .get('/api/v1/guilds')
        .set('X-API-Key', validApiKey)
        .query({ page: 1, limit: 20 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('page', 1);
      expect(res.body.pagination).toHaveProperty('limit', 20);
      expect(res.body.pagination).toHaveProperty('total', 1);
      expect(res.body.pagination).toHaveProperty('hasNext', false);
      expect(res.body.pagination).toHaveProperty('hasPrevious', false);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data).toHaveLength(1);
    });

    it('should use default pagination values', async () => {
      // Configure mock response with default pagination
      (global as any).setMockRedisResponse('GUILD_LIST', {
        data: {
          guilds: [mockGuild],
          total: 1
        }
      });

      const res = await request(app)
        .get('/api/v1/guilds')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
    });

    it('should validate pagination limits', async () => {
      const res = await request(app)
        .get('/api/v1/guilds')
        .set('X-API-Key', validApiKey)
        .query({ page: 0, limit: 200 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .get('/api/v1/guilds');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle gateway service timeout', async () => {
      // Don't configure mock response to trigger timeout
      // This will cause the request to timeout waiting for a response

      const res = await request(app)
        .get('/api/v1/guilds')
        .set('X-API-Key', validApiKey)
        .query({ page: 1, limit: 20 });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('GET /api/v1/guilds/:guildId', () => {
    it('should return specific guild information', async () => {
      // Configure mock response for specific guild
      (global as any).setMockRedisResponse('GUILD_INFO', {
        data: mockGuild
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('id', validGuildId);
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('available');
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .get('/api/v1/guilds/invalid-id')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
    });

    it('should handle guild not found', async () => {
      // Configure mock response for guild not found
      (global as any).setMockRedisResponse('GUILD_INFO', {
        error: 'Guild not found'
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/guilds/:guildId/settings', () => {
    it('should return guild settings from database', async () => {
      const mockDbSettings = {
        guildId: validGuildId,
        autoplayEnabled: false,
        djRoleId: '111222333444555666',
        maxQueueSize: 100,
        allowExplicitContent: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(prisma.serverConfiguration.findUnique).mockResolvedValue(mockDbSettings);

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('autoplay', false);
      expect(res.body.data).toHaveProperty('defaultVolume');
      expect(res.body.data).toHaveProperty('maxQueueSize');
    });

    it('should return default settings if none exist', async () => {
      vi.mocked(prisma.serverConfiguration.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('defaultVolume', 50);
      expect(res.body.data).toHaveProperty('autoplay', false);
      expect(res.body.data).toHaveProperty('maxQueueSize', 100);
    });

    it('should validate guild ID', async () => {
      const res = await request(app)
        .get('/api/v1/guilds/invalid/settings')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(prisma.serverConfiguration.findUnique).mockRejectedValue(
        new Error('Database connection failed')
      );

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('PUT /api/v1/guilds/:guildId/settings', () => {
    it('should update guild settings successfully', async () => {
      const updatedSettings = {
        guildId: validGuildId,
        autoplayEnabled: true,
        djRoleId: '111222333444555666',
        maxQueueSize: 150,
        allowExplicitContent: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(prisma.serverConfiguration.upsert).mockResolvedValue(updatedSettings);

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey)
        .send({
          autoplay: true,
          maxQueueSize: 150,
          allowExplicitContent: false
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('autoplay', true);
      expect(res.body.data).toHaveProperty('maxQueueSize', 150);
      expect(res.body.data).toHaveProperty('allowExplicitContent', false);
      expect(prisma.serverConfiguration.upsert).toHaveBeenCalled();
    });

    it('should validate settings data', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey)
        .send({
          defaultVolume: 150, // Invalid: max is 100
          maxQueueSize: -10 // Invalid: must be positive
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .put('/api/v1/guilds/invalid/settings')
        .set('X-API-Key', validApiKey)
        .send({ autoplay: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database upsert errors', async () => {
      vi.mocked(prisma.serverConfiguration.upsert).mockRejectedValue(
        new Error('Database write failed')
      );

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey)
        .send({ autoplay: true });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should accept partial updates', async () => {
      const updatedSettings = {
        guildId: validGuildId,
        autoplayEnabled: true,
        djRoleId: null,
        maxQueueSize: 100,
        allowExplicitContent: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(prisma.serverConfiguration.upsert).mockResolvedValue(updatedSettings);

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey)
        .send({ autoplay: true }); // Only update one field

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('autoplay', true);
    });

    it('should validate DJ role ID format if provided', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/settings`)
        .set('X-API-Key', validApiKey)
        .send({
          djRoleId: 'invalid-role-id'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
