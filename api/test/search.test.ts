import request from 'supertest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { mockTrack, validApiKey } from './fixtures.js';

const lavalinkPayload = {
  loadType: 'search',
  data: [
    {
      info: {
        title: mockTrack.title,
        author: mockTrack.author,
        uri: mockTrack.uri,
        identifier: mockTrack.identifier,
        length: mockTrack.duration,
        isSeekable: mockTrack.isSeekable,
        isStream: mockTrack.isStream,
        artworkUrl: mockTrack.thumbnail,
        sourceName: mockTrack.source
      }
    }
  ]
} as const;

const successResponse = {
  ok: true,
  json: async () => lavalinkPayload,
  text: async () => JSON.stringify(lavalinkPayload)
} as unknown as Response;

let fetchSpy: ReturnType<typeof vi.spyOn>;

describe('Search Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('GET /api/v1/search', () => {
    it('returns search results from Lavalink', async () => {
      fetchSpy.mockResolvedValue(successResponse);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test query' });

      expect(res.status).toBe(200);
      expect(res.body.data.tracks).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('validates query parameter presence', async () => {
      fetchSpy.mockResolvedValue(successResponse);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates query max length', async () => {
      fetchSpy.mockResolvedValue(successResponse);
      const longQuery = 'a'.repeat(501);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: longQuery });

      expect(res.status).toBe(400);
    });

    it('respects source filter', async () => {
      fetchSpy.mockResolvedValue(successResponse);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test', source: 'spotify' });

      expect(res.status).toBe(200);
      const calledUrl = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('identifier')).toContain('spsearch:');
    });

    it('handles backend failures gracefully', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
        text: async () => 'error'
      } as unknown as Response);

      const res = await request(app)
        .get('/api/v1/search')
        .set('X-API-Key', validApiKey)
        .query({ q: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
