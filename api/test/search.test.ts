import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import Redis from 'ioredis';
import { mockSearchResult, mockTrack, validApiKey } from './fixtures.js';

describe('Search Routes', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = new Redis();
    vi.clearAllMocks();
  });

  describe('GET /api/v1/search', () => {
    it('should return search results successfully', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test query' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('tracks');
      expect(res.body.data).toHaveProperty('source');
      expect(res.body.data).toHaveProperty('query', 'test query');
      expect(res.body.data).toHaveProperty('totalResults');
      expect(res.body.data.tracks).toBeInstanceOf(Array);
    });

    it('should validate query parameter is required', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate query parameter is not empty', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate query parameter is not too long', async () => {
      const longQuery = 'a'.repeat(501);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: longQuery });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should trim query parameter', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: { ...mockSearchResult, query: 'test query' }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: '  test query  ' });

      expect(res.status).toBe(200);
    });

    it('should accept source filter - youtube', async () => {
      const youtubeResult = {
        ...mockSearchResult,
        source: 'youtube'
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: youtubeResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'youtube' });

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('youtube');
    });

    it('should accept source filter - spotify', async () => {
      const spotifyResult = {
        ...mockSearchResult,
        source: 'spotify',
        tracks: [{ ...mockTrack, source: 'spotify' as const }]
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: spotifyResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'spotify' });

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('spotify');
    });

    it('should accept source filter - soundcloud', async () => {
      const soundcloudResult = {
        ...mockSearchResult,
        source: 'soundcloud',
        tracks: [{ ...mockTrack, source: 'soundcloud' as const }]
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: soundcloudResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'soundcloud' });

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('soundcloud');
    });

    it('should accept source filter - all', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'all' });

      expect(res.status).toBe(200);
    });

    it('should use default pagination when not provided', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test' });

      expect(res.status).toBe(200);
      expect(mockRedis.publish).toHaveBeenCalled();
    });

    it('should accept page parameter', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', page: 2 });

      expect(res.status).toBe(200);
    });

    it('should accept limit parameter', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: {
                ...mockSearchResult,
                tracks: Array(50).fill(mockTrack)
              }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', limit: 50 });

      expect(res.status).toBe(200);
      expect(res.body.data.tracks).toBeInstanceOf(Array);
    });

    it('should validate page is positive', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', page: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate limit is positive', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', limit: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate limit does not exceed maximum', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', limit: 101 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return empty results when no matches found', async () => {
      const emptyResult = {
        tracks: [],
        source: 'youtube',
        query: 'nonexistent song xyz123',
        totalResults: 0
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: emptyResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'nonexistent song xyz123' });

      expect(res.status).toBe(200);
      expect(res.body.data.tracks).toHaveLength(0);
      expect(res.body.data.totalResults).toBe(0);
    });

    it('should include request ID in response', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .set('X-Request-ID', 'search-test-123')
        .query({ q: 'test' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('requestId');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .get('/api/v1/search')
        .query({ q: 'test' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle audio service timeout', async () => {
      mockRedis.on.mockImplementation(() => {});

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle audio service error', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              error: 'Search service unavailable'
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should handle invalid JSON response from audio service', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', 'invalid json');
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('should publish search request to correct Redis channel', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'youtube', page: 2, limit: 30 });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'discord-bot:search-request',
        expect.stringContaining('SEARCH_TRACKS')
      );

      const publishCall = mockRedis.publish.mock.calls[0];
      const publishedData = JSON.parse(publishCall[1]);
      expect(publishedData).toHaveProperty('type', 'SEARCH_TRACKS');
      expect(publishedData).toHaveProperty('query', 'test');
      expect(publishedData).toHaveProperty('source', 'youtube');
      expect(publishedData).toHaveProperty('page', 2);
      expect(publishedData).toHaveProperty('limit', 30);
    });

    it('should handle multiple search requests concurrently', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: mockSearchResult
            }));
          }, 10);
        }
      });

      const requests = [
        request(app).get('/api/v1/search').set('X-API-Key', validApiKey).query({ q: 'test1' }),
        request(app).get('/api/v1/search').set('X-API-Key', validApiKey).query({ q: 'test2' }),
        request(app).get('/api/v1/search').set('X-API-Key', validApiKey).query({ q: 'test3' })
      ];

      const responses = await Promise.all(requests);

      responses.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('tracks');
      });
    });

    it('should handle special characters in query', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: { ...mockSearchResult, query: 'artist - song (remix) [official]' }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'artist - song (remix) [official]' });

      expect(res.status).toBe(200);
    });

    it('should handle unicode characters in query', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('search-response:test', JSON.stringify({
              data: { ...mockSearchResult, query: '日本の音楽' }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: '日本の音楽' });

      expect(res.status).toBe(200);
    });
  });
});
