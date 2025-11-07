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

/**
 * Music Queue API Router
 *
 * Implements REST endpoints for Discord music queue management
 * Following Discord.js v14 best practices and microservices architecture
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication
const redis = new Redis(env.REDIS_URL);

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

  // Create response listener
  const responsePromise = new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      redis.unsubscribe(`audio-response:${requestId}`);
      reject(new Error('Audio service timeout'));
    }, timeoutMs);

    redis.subscribe(`audio-response:${requestId}`, (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    redis.on('message', (channel, message) => {
      if (channel === `audio-response:${requestId}`) {
        clearTimeout(timeout);
        redis.unsubscribe(`audio-response:${requestId}`);

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
      }
    });
  });

  // Send request to audio service
  await redis.publish('discord-bot:audio-request', JSON.stringify({
    requestId,
    type: requestType,
    ...payload
  }));

  return responsePromise;
}

/**
 * GET /api/v1/guilds/:guildId/queue
 * Get current queue for a guild
 */
router.get('/:guildId/queue', validateGuildId, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      guildId
    }, 'Fetching queue from audio service');

    // Request queue data from audio service
    const queueData = await requestFromAudio<Queue>('GET_QUEUE', { guildId });

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
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        query: addTrackData.query,
        position: addTrackData.position
      }, 'Adding track to queue via audio service');

      // Request to add track via audio service
      const result = await requestFromAudio<AddTrackResponse>('ADD_TRACK', {
        guildId,
        ...addTrackData
      });

      const response: APIResponse<AddTrackResponse> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        trackTitle: result.track.title,
        position: result.position
      }, 'Track added to queue successfully');

      res.json(response);
    } catch (error) {
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
      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        position: trackPosition
      }, 'Removing track from queue via audio service');

      // Request to remove track via audio service
      const result = await requestFromAudio<RemoveTrackResponse>('REMOVE_TRACK', {
        guildId,
        position: trackPosition
      });

      const response: APIResponse<RemoveTrackResponse> = {
        data: result,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string
      };

      logger.info({
        requestId: req.headers['x-request-id'],
        guildId,
        removedTrack: result.removedTrack.title,
        position: trackPosition
      }, 'Track removed from queue successfully');

      res.json(response);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundError(`Track at position ${trackPosition}`);
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
