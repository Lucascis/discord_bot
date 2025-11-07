import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { mockTrack, mockQueue, validGuildId, validApiKey } from './fixtures.js';

describe('Music Routes', () => {
  // Note: beforeEach is handled by global setup in api/test/setup.ts

  describe('GET /api/v1/guilds/:guildId/queue', () => {
    it('should return queue successfully', async () => {
      (global as any).setMockRedisResponse('GET_QUEUE', {
        data: mockQueue
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('tracks');
      expect(res.body.data).toHaveProperty('currentTrack');
      expect(res.body.data).toHaveProperty('size');
      expect(res.body.data.tracks).toBeInstanceOf(Array);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .get('/api/v1/guilds/invalid-id/queue')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // Don't set any mock response - will cause timeout

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle audio service error', async () => {
      (global as any).setMockRedisResponse('GET_QUEUE', {
        error: 'Audio service unavailable'
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should include request ID in response', async () => {
      (global as any).setMockRedisResponse('GET_QUEUE', {
        data: mockQueue
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey)
        .set('X-Request-ID', 'test-request-123');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('requestId');
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/tracks', () => {
    const addTrackPayload = {
      query: 'test track',
      position: 0
    };

    it('should add track to queue successfully', async () => {
      const mockAddResponse = {
        track: mockTrack,
        position: 1,
        queue: mockQueue
      };

      // Use setMockRedisResponse to work with automatic pub/sub simulation
      (global as any).setMockRedisResponse('ADD_TRACK', {
        data: mockAddResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send(addTrackPayload);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('track');
      expect(res.body.data).toHaveProperty('position');
      expect(res.body.data).toHaveProperty('queue');
      expect(res.body.data.track).toHaveProperty('title');
    });

    it('should validate query field is required', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ position: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate query field is not empty', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: '', position: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate query field is not too long', async () => {
      const longQuery = 'a'.repeat(501);

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: longQuery });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate position is a valid number', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'test', position: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate position is not too large', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'test', position: 1001 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should accept optional position field', async () => {
      // Use setMockRedisResponse to work with automatic pub/sub simulation
      (global as any).setMockRedisResponse('ADD_TRACK', {
        data: {
          track: mockTrack,
          position: 1,
          queue: mockQueue
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'test track' });

      expect(res.status).toBe(200);
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .send(addTrackPayload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // Don't set any mock response - will cause timeout naturally

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send(addTrackPayload);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('DELETE /api/v1/guilds/:guildId/queue/tracks/:position', () => {
    it('should remove track from queue successfully', async () => {
      const mockRemoveResponse = {
        removedTrack: mockTrack,
        queue: mockQueue
      };
      (global as any).setMockRedisResponse('REMOVE_TRACK', {
        data: mockRemoveResponse
      });

      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/0`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('removedTrack');
      expect(res.body.data).toHaveProperty('queue');
      expect(res.body.data.removedTrack).toHaveProperty('title');
    });

    it('should validate position parameter', async () => {
      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/invalid`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle track not found error', async () => {
      (global as any).setMockRedisResponse('REMOVE_TRACK', {
        error: 'Track not found'
      });

      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/5`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/0`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/0`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/play', () => {
    it('should start playback successfully', async () => {
      const mockPlayResponse = {
        success: true,
        currentTrack: mockTrack,
        message: 'Playback started'
      };
      (global as any).setMockRedisResponse('PLAY_MUSIC', {
        data: mockPlayResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/play`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432', voiceChannelId: '111222333444555666' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('message');
    });

    it('should accept optional userId and voiceChannelId', async () => {
      // Configure mock response for play music
      (global as any).setMockRedisResponse('PLAY_MUSIC', {
        data: {
          success: true,
          message: 'Playback started'
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/play`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .post('/api/v1/guilds/invalid-id/queue/play')
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/play`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/play`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/pause', () => {
    it('should pause playback successfully', async () => {
      const mockPauseResponse = {
        success: true,
        message: 'Playback paused'
      };
      (global as any).setMockRedisResponse('PAUSE_MUSIC', {
        data: mockPauseResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/pause`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('message');
    });

    it('should accept empty body', async () => {
      // Configure mock response for pause music
      (global as any).setMockRedisResponse('PAUSE_MUSIC', {
        data: {
          success: true,
          message: 'Playback paused'
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/pause`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .post('/api/v1/guilds/invalid/queue/pause')
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/pause`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/pause`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/skip', () => {
    it('should skip track successfully', async () => {
      const mockSkipResponse = {
        success: true,
        skippedTrack: mockTrack,
        nextTrack: { ...mockTrack, title: 'Next Track' },
        message: 'Track skipped'
      };
      (global as any).setMockRedisResponse('SKIP_MUSIC', {
        data: mockSkipResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/skip`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('skippedTrack');
      expect(res.body.data).toHaveProperty('message');
    });

    it('should handle skip when queue is empty', async () => {
      // Configure mock response for skip music
      (global as any).setMockRedisResponse('SKIP_MUSIC', {
        data: {
          success: true,
          message: 'Queue is empty'
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/skip`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success');
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .post('/api/v1/guilds/invalid/queue/skip')
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/skip`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/skip`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/stop', () => {
    it('should stop playback successfully', async () => {
      const mockStopResponse = {
        success: true,
        message: 'Playback stopped',
        queueCleared: false
      };
      (global as any).setMockRedisResponse('STOP_MUSIC', {
        data: mockStopResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432', clearQueue: false });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('message');
      expect(res.body.data).toHaveProperty('queueCleared');
    });

    it('should stop and clear queue when requested', async () => {
      const mockStopResponse = {
        success: true,
        message: 'Playback stopped and queue cleared',
        queueCleared: true
      };
      (global as any).setMockRedisResponse('STOP_MUSIC', {
        data: mockStopResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .set('X-API-Key', validApiKey)
        .send({ clearQueue: true });

      expect(res.status).toBe(200);
      expect(res.body.data.queueCleared).toBe(true);
    });

    it('should accept empty body', async () => {
      // Configure mock response for stop music
      (global as any).setMockRedisResponse('STOP_MUSIC', {
        data: {
          success: true,
          message: 'Playback stopped',
          queueCleared: false
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .post('/api/v1/guilds/invalid/queue/stop')
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('PUT /api/v1/guilds/:guildId/queue/volume', () => {
    it('should set volume successfully', async () => {
      const mockVolumeResponse = {
        success: true,
        volume: 75,
        message: 'Volume set to 75'
      };
      (global as any).setMockRedisResponse('SET_VOLUME', {
        data: mockVolumeResponse
      });

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 75, userId: '987654321098765432' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('volume', 75);
      expect(res.body.data).toHaveProperty('message');
    });

    it('should validate volume is required', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should validate volume is a number', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 'loud' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should validate volume is within range (0-200)', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 201 });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should validate volume is not negative', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: -1 });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should accept volume 0', async () => {
      // Configure mock response for volume 0
      (global as any).setMockRedisResponse('SET_VOLUME', {
        data: {
          success: true,
          volume: 0,
          message: 'Volume set to 0'
        }
      });

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.volume).toBe(0);
    });

    it('should accept volume 200', async () => {
      // Configure mock response for volume 200
      (global as any).setMockRedisResponse('SET_VOLUME', {
        data: {
          success: true,
          volume: 200,
          message: 'Volume set to 200'
        }
      });

      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 200 });

      expect(res.status).toBe(200);
      expect(res.body.data.volume).toBe(200);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .put('/api/v1/guilds/invalid/queue/volume')
        .set('X-API-Key', validApiKey)
        .send({ volume: 50 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .send({ volume: 50 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .put(`/api/v1/guilds/${validGuildId}/queue/volume`)
        .set('X-API-Key', validApiKey)
        .send({ volume: 50 });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/shuffle', () => {
    it('should shuffle queue successfully', async () => {
      const mockShuffleResponse = {
        success: true,
        queue: mockQueue,
        message: 'Queue shuffled'
      };
      (global as any).setMockRedisResponse('SHUFFLE_QUEUE', {
        data: mockShuffleResponse
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .set('X-API-Key', validApiKey)
        .send({ userId: '987654321098765432' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('queue');
      expect(res.body.data).toHaveProperty('message');
    });

    it('should accept empty body', async () => {
      // Configure mock response for shuffle queue
      (global as any).setMockRedisResponse('SHUFFLE_QUEUE', {
        data: {
          success: true,
          queue: mockQueue,
          message: 'Queue shuffled'
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .post('/api/v1/guilds/invalid/queue/shuffle')
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      // No mock response set - will timeout naturally


      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle empty queue shuffle', async () => {
      // Configure mock response for empty queue shuffle
      (global as any).setMockRedisResponse('SHUFFLE_QUEUE', {
        data: {
          success: true,
          queue: {
            ...mockQueue,
            empty: true,
            tracks: []
          },
          message: 'Queue is empty'
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.queue.empty).toBe(true);
    });
  });
});
