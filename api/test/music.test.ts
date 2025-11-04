import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import Redis from 'ioredis';
import { mockTrack, mockQueue, validGuildId, validApiKey } from './fixtures.js';

describe('Music Routes', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = new Redis();
    vi.clearAllMocks();
  });

  describe('GET /api/v1/guilds/:guildId/queue', () => {
    it('should return queue successfully', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockQueue
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation(() => {});

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle audio service error', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              error: 'Audio service unavailable'
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should include request ID in response', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockQueue
            }));
          }, 10);
        }
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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockAddResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { track: mockTrack, position: 1, queue: mockQueue }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockRemoveResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              error: 'Track not found at position 5'
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockPlayResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, message: 'Playback resumed' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockPauseResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, message: 'Paused' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockSkipResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, message: 'Queue is empty', skippedTrack: mockTrack }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockStopResponse
            }));
          }, 10);
        }
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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockStopResponse
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/stop`)
        .set('X-API-Key', validApiKey)
        .send({ clearQueue: true });

      expect(res.status).toBe(200);
      expect(res.body.data.queueCleared).toBe(true);
    });

    it('should accept empty body', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, message: 'Stopped' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockVolumeResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, volume: 0, message: 'Volume muted' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, volume: 200, message: 'Volume max' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

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

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: mockShuffleResponse
            }));
          }, 10);
        }
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
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: { success: true, queue: mockQueue, message: 'Shuffled' }
            }));
          }, 10);
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
      mockRedis.on.mockImplementation(() => {});

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/shuffle`)
        .set('X-API-Key', validApiKey)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle empty queue shuffle', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('audio-response:test', JSON.stringify({
              data: {
                success: true,
                queue: { ...mockQueue, tracks: [], size: 0, empty: true },
                message: 'Queue is empty'
              }
            }));
          }, 10);
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
