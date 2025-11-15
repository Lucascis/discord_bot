import request from 'supertest';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '@discord-bot/database';
import { mockTrack, validApiKey, validGuildId } from './fixtures.js';

const baseQueueItem = {
  id: 'queue-item-1',
  queueId: 'queue-1',
  title: mockTrack.title,
  url: mockTrack.uri,
  requestedBy: mockTrack.requester?.id ?? 'user-1',
  duration: mockTrack.duration,
  createdAt: new Date()
};

const queueRecord = {
  id: 'queue-1',
  guildId: validGuildId,
  createdAt: new Date(),
  voiceChannelId: null,
  textChannelId: null,
  items: [baseQueueItem]
};

const lavalinkResponse = {
  loadType: 'search',
  data: [
    {
      info: {
        title: mockTrack.title,
        author: mockTrack.author,
        uri: mockTrack.uri,
        identifier: mockTrack.identifier,
        length: mockTrack.duration,
        isSeekable: true,
        isStream: false,
        artworkUrl: mockTrack.thumbnail,
        sourceName: mockTrack.source
      }
    }
  ]
};

describe('Music Queue Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.queue.findFirst).mockReset();
    vi.mocked(prisma.queue.create).mockReset();
    vi.mocked(prisma.queueItem.create).mockReset();
    vi.mocked(prisma.queueItem.delete).mockReset();
  });

  describe('GET /api/v1/guilds/:guildId/queue', () => {
    it('returns empty queue when none exists', async () => {
      vi.mocked(prisma.queue.findFirst).mockResolvedValue(null as never);

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data.tracks).toHaveLength(0);
    });

    it('returns queue items from database', async () => {
      vi.mocked(prisma.queue.findFirst).mockResolvedValue(queueRecord as never);

      const res = await request(app)
        .get(`/api/v1/guilds/${validGuildId}/queue`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data.tracks).toHaveLength(1);
      expect(res.body.data.tracks[0].title).toBe(mockTrack.title);
    });
  });

  describe('POST /api/v1/guilds/:guildId/queue/tracks', () => {
    it('adds track to queue when search succeeds', async () => {
      const findFirstMock = vi.mocked(prisma.queue.findFirst);
      findFirstMock
        .mockResolvedValueOnce(null as never) // ensureQueue
        .mockResolvedValueOnce(queueRecord as never); // fetchQueueWithItems
      vi.mocked(prisma.queue.create).mockResolvedValue({ id: 'queue-1', guildId: validGuildId } as never);
      vi.mocked(prisma.queueItem.create).mockResolvedValue(baseQueueItem as never);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => lavalinkResponse,
        text: async () => JSON.stringify(lavalinkResponse)
      } as unknown as Response);

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'test track', requestedBy: mockTrack.requester?.id });

      expect(res.status).toBe(200);
      expect(prisma.queueItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: mockTrack.title })
        })
      );
      expect(res.body.data.queue.tracks).toHaveLength(1);
    });

    it('validates requestedBy parameter', async () => {
      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'test track' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when search returns no tracks', async () => {
      const findFirstMock = vi.mocked(prisma.queue.findFirst);
      findFirstMock
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({ ...queueRecord, items: [] } as never);
      vi.mocked(prisma.queue.create).mockResolvedValue({ id: 'queue-1', guildId: validGuildId } as never);
      vi.mocked(prisma.queueItem.create).mockResolvedValue(baseQueueItem as never);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ loadType: 'search', data: [] }),
        text: async () => 'empty'
      } as unknown as Response);

      const res = await request(app)
        .post(`/api/v1/guilds/${validGuildId}/queue/tracks`)
        .set('X-API-Key', validApiKey)
        .send({ query: 'missing', requestedBy: mockTrack.requester?.id });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/guilds/:guildId/queue/tracks/:position', () => {
    it('removes track at given position', async () => {
      const findFirstMock = vi.mocked(prisma.queue.findFirst);
      findFirstMock
        .mockResolvedValueOnce(queueRecord as never)
        .mockResolvedValueOnce({ ...queueRecord, items: [] } as never);
      vi.mocked(prisma.queueItem.delete).mockResolvedValue(baseQueueItem as never);

      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/0`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data.removedTrack.title).toBe(mockTrack.title);
      expect(prisma.queueItem.delete).toHaveBeenCalledWith({ where: { id: baseQueueItem.id } });
    });

    it('returns 404 when track position is invalid', async () => {
      vi.mocked(prisma.queue.findFirst).mockResolvedValue({ ...queueRecord, items: [] } as never);

      const res = await request(app)
        .delete(`/api/v1/guilds/${validGuildId}/queue/tracks/0`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(404);
    });
  });
});
