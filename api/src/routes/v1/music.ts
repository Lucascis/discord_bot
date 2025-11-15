import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateGuildId, validateAddTrack, validateTrackPosition } from '../../middleware/validation.js';
import { NotFoundError, InternalServerError } from '../../middleware/error-handler.js';
import type {
  APIResponse,
  Queue,
  Track,
  AddTrackRequest,
  AddTrackResponse,
  RemoveTrackResponse
} from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import Redis from 'ioredis';
import { env } from '@discord-bot/config';
import { prisma } from '@discord-bot/database';
import { searchTracksViaLavalink } from '../../services/lavalink-search-service.js';

/**
 * Music Queue API Router
 *
 * Implements REST endpoints for Discord music queue management
 * Following Discord.js v14 best practices and microservices architecture
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication (legacy playback control)
const redis = new Redis(env.REDIS_URL);

type QueueItemRecord = {
  id: string;
  queueId: string;
  title: string;
  url: string;
  requestedBy: string;
  duration: number;
  createdAt: Date;
};

function inferSourceFromUrl(url: string): Track['source'] {
  const normalized = url.toLowerCase();
  if (normalized.includes('spotify.com')) return 'spotify';
  if (normalized.includes('soundcloud.com')) return 'soundcloud';
  if (normalized.includes('twitch.tv')) return 'twitch';
  if (normalized.includes('bandcamp.com')) return 'bandcamp';
  if (normalized.includes('vimeo.com')) return 'vimeo';
  if (normalized.startsWith('http')) return 'http';
  return 'youtube';
}

function mapItemsToTracks(items: QueueItemRecord[]): Track[] {
  return items.map((item, index) => ({
    title: item.title,
    author: 'Unknown',
    uri: item.url,
    identifier: item.id,
    duration: item.duration,
    isSeekable: true,
    isStream: false,
    thumbnail: undefined,
    source: inferSourceFromUrl(item.url),
    requester: {
      id: item.requestedBy,
      username: item.requestedBy
    },
    position: index
  }));
}

function buildQueueResponse(guildId: string, items: QueueItemRecord[]): Queue {
  const tracks = mapItemsToTracks(items);
  return {
    guildId,
    tracks,
    currentTrack: tracks[0],
    position: 0,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    size: tracks.length,
    empty: tracks.length === 0
  };
}

async function fetchQueueWithItems(guildId: string) {
  return prisma.queue.findFirst({
    where: { guildId },
    include: {
      items: {
        orderBy: {
          createdAt: 'asc'
        }
      }
    }
  });
}

async function ensureQueue(guildId: string) {
  const existing = await prisma.queue.findFirst({
    where: { guildId }
  });

  if (existing) {
    return existing;
  }

  return prisma.queue.create({
    data: { guildId }
  });
}

/**
 * Helper function to request data from Audio service via Redis
 * Implements request-response pattern with timeout
 */
async function requestFromAudio<T>(
  requestType: string,
  payload: Record<string, unknown>,
  timeoutMs: number = process.env.NODE_ENV === 'test' ? 2000 : 10000
): Promise<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const responseChannel = `audio-response:${requestId}`;

  await redis.subscribe(responseChannel);

  return new Promise<T>((resolve, reject) => {
    let settled = false;

      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        void redis.unsubscribe(responseChannel).catch(() => undefined);
        if (typeof redis.off === 'function') {
          redis.off('message', onMessage);
        } else {
          redis.removeListener('message', onMessage);
        }
        clearTimeout(timeout);
      };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Audio service timeout'));
    }, timeoutMs);

    const onMessage = (channel: string, message: string) => {
      if (channel !== responseChannel) {
        return;
      }

      cleanup();

      try {
        const response = JSON.parse(message);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data);
        }
      } catch {
        reject(new Error('Invalid response format'));
      }
    };

    redis.on('message', onMessage);

    redis.publish('discord-bot:audio-request', JSON.stringify({
      requestId,
      type: requestType,
      ...payload
    })).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * GET /api/v1/guilds/:guildId/queue
 * Get current queue for a guild
 */
router.get('/:guildId/queue', validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  try {
    const queueRecord = await fetchQueueWithItems(guildId);
    const queueData = buildQueueResponse(guildId, queueRecord?.items ?? []);

    const response: APIResponse<Queue> = {
      data: queueData,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Failed to fetch queue');

    throw new InternalServerError('Failed to fetch queue');
  }
}));

/**
 * POST /api/v1/guilds/:guildId/queue/tracks
 * Add track to queue
 */
router.post('/:guildId/queue/tracks',
  validateGuildId,
  validateAddTrack,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const addTrackData: AddTrackRequest = req.body;

    try {
      const queue = await ensureQueue(guildId);
      const searchResult = await searchTracksViaLavalink(
        addTrackData.query,
        addTrackData.source ?? 'all',
        1,
        1
      );

      if (!searchResult.tracks.length) {
        throw new NotFoundError('Track');
      }

      const track = searchResult.tracks[0];

      await prisma.queueItem.create({
        data: {
          queueId: queue.id,
          title: track.title,
          url: track.uri,
          requestedBy: addTrackData.requestedBy,
          duration: track.duration
        }
      });

      const updatedQueue = await fetchQueueWithItems(guildId);

      const result: AddTrackResponse = {
        track,
        position: Math.max(0, (updatedQueue?.items.length ?? 1) - 1),
        queue: buildQueueResponse(guildId, updatedQueue?.items ?? [])
      };

      const response: APIResponse<AddTrackResponse> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        query: addTrackData.query
      }, 'Failed to add track to queue');

      throw new InternalServerError('Failed to add track to queue');
    }
  })
);

/**
 * DELETE /api/v1/guilds/:guildId/queue/tracks/:position
 * Remove track from queue at specific position
 */
router.delete('/:guildId/queue/tracks/:position',
  validateTrackPosition,
  asyncHandler(async (req, res) => {
    const { guildId, position } = req.params;
    const trackPosition = parseInt(position, 10);

    try {
      const queueRecord = await fetchQueueWithItems(guildId);

      if (!queueRecord || !queueRecord.items.length) {
        throw new NotFoundError('Queue');
      }

      if (trackPosition < 0 || trackPosition >= queueRecord.items.length) {
        throw new NotFoundError('Track');
      }

      const targetItem = queueRecord.items[trackPosition];

      await prisma.queueItem.delete({
        where: { id: targetItem.id }
      });

      const updatedQueue = await fetchQueueWithItems(guildId);

      const removedTrack: Track = {
        title: targetItem.title,
        author: 'Unknown',
        uri: targetItem.url,
        identifier: targetItem.id,
        duration: targetItem.duration,
        isSeekable: true,
        isStream: false,
        thumbnail: undefined,
        source: inferSourceFromUrl(targetItem.url),
        requester: {
          id: targetItem.requestedBy,
          username: targetItem.requestedBy
        }
      };

      const result: RemoveTrackResponse = {
        removedTrack,
        queue: buildQueueResponse(guildId, updatedQueue?.items ?? [])
      };

      const response: APIResponse<RemoveTrackResponse> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        position: trackPosition
      }, 'Failed to remove track from queue');

      throw new InternalServerError('Failed to remove track from queue');
    }
  })
);

/**
 * POST /api/v1/guilds/:guildId/queue/play
 * Start playing music or resume playback
 */
router.post('/:guildId/queue/play',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { userId, voiceChannelId } = req.body as {
      userId?: string;
      voiceChannelId?: string;
    };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        userId,
        voiceChannelId
      }, 'Starting playback via audio service');

      // Request to start playback via audio service
      const result = await requestFromAudio<{
        success: boolean;
        currentTrack?: Track;
        message: string;
      }>('PLAY_MUSIC', {
        guildId,
        userId,
        voiceChannelId
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success
      }, 'Playback command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId
      }, 'Failed to start playback');

      throw new InternalServerError('Failed to start playback');
    }
  })
);

/**
 * POST /api/v1/guilds/:guildId/queue/pause
 * Pause current playback
 */
router.post('/:guildId/queue/pause',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.body as { userId?: string };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        userId
      }, 'Pausing playback via audio service');

      // Request to pause playback via audio service
      const result = await requestFromAudio<{
        success: boolean;
        message: string;
      }>('PAUSE_MUSIC', {
        guildId,
        userId
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success
      }, 'Pause command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId
      }, 'Failed to pause playback');

      throw new InternalServerError('Failed to pause playback');
    }
  })
);

/**
 * POST /api/v1/guilds/:guildId/queue/skip
 * Skip to next track
 */
router.post('/:guildId/queue/skip',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.body as { userId?: string };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        userId
      }, 'Skipping track via audio service');

      // Request to skip track via audio service
      const result = await requestFromAudio<{
        success: boolean;
        skippedTrack?: Track;
        nextTrack?: Track;
        message: string;
      }>('SKIP_MUSIC', {
        guildId,
        userId
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success,
        skippedTrack: result.skippedTrack?.title
      }, 'Skip command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId
      }, 'Failed to skip track');

      throw new InternalServerError('Failed to skip track');
    }
  })
);

/**
 * POST /api/v1/guilds/:guildId/queue/stop
 * Stop playback and disconnect
 */
router.post('/:guildId/queue/stop',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { userId, clearQueue = false } = req.body as {
      userId?: string;
      clearQueue?: boolean;
    };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        userId,
        clearQueue
      }, 'Stopping playback via audio service');

      // Request to stop playback via audio service
      const result = await requestFromAudio<{
        success: boolean;
        message: string;
        queueCleared?: boolean;
      }>('STOP_MUSIC', {
        guildId,
        userId,
        clearQueue
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success,
        queueCleared: result.queueCleared
      }, 'Stop command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId
      }, 'Failed to stop playback');

      throw new InternalServerError('Failed to stop playback');
    }
  })
);

/**
 * PUT /api/v1/guilds/:guildId/queue/volume
 * Set playback volume
 */
router.put('/:guildId/queue/volume',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { volume, userId } = req.body as {
      volume: number;
      userId?: string;
    };

    // Validate volume range
    if (typeof volume !== 'number' || volume < 0 || volume > 200) {
      throw new InternalServerError('Volume must be between 0 and 200');
    }

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        volume,
        userId
      }, 'Setting volume via audio service');

      // Request to set volume via audio service
      const result = await requestFromAudio<{
        success: boolean;
        volume: number;
        message: string;
      }>('SET_VOLUME', {
        guildId,
        volume,
        userId
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success,
        volume: result.volume
      }, 'Volume command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId,
        volume
      }, 'Failed to set volume');

      throw new InternalServerError('Failed to set volume');
    }
  })
);

/**
 * POST /api/v1/guilds/:guildId/queue/shuffle
 * Shuffle the current queue
 */
router.post('/:guildId/queue/shuffle',
  validateGuildId,
  asyncHandler(async (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.body as { userId?: string };

    try {
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        userId
      }, 'Shuffling queue via audio service');

      // Request to shuffle queue via audio service
      const result = await requestFromAudio<{
        success: boolean;
        queue: Queue;
        message: string;
      }>('SHUFFLE_QUEUE', {
        guildId,
        userId
      });

      const response: APIResponse<typeof result> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        success: result.success,
        queueLength: result.queue?.tracks?.length || 0
      }, 'Shuffle command processed');

      res.json(response);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        requestId: req.headers['x-request-id'],
        guildId
      }, 'Failed to shuffle queue');

      throw new InternalServerError('Failed to shuffle queue');
    }
  })
);

export default router;
