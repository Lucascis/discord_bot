import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateSearch } from '../../middleware/validation.js';
import { InternalServerError } from '../../middleware/error-handler.js';
import type { APIResponse, SearchResult } from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import Redis from 'ioredis';
import { env } from '@discord-bot/config';

/**
 * Search API Router
 *
 * Implements REST endpoints for track search functionality
 * Following Discord.js v14 best practices and microservices architecture
 */

const router: ExpressRouter = Router();

// Redis client for inter-service communication
const redis = new Redis(env.REDIS_URL);

/**
 * Helper function to request search data from Audio service via Redis
 * Implements request-response pattern with timeout
 */
async function requestSearch(
  query: string,
  source?: string,
  page: number = 1,
  limit: number = 20,
  timeoutMs: number = process.env.NODE_ENV === 'test' ? 2000 : 15000
): Promise<SearchResult> {
  const requestId = `search_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  // Create response listener
  const responsePromise = new Promise<SearchResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      redis.unsubscribe(`search-response:${requestId}`);
      reject(new Error('Search service timeout'));
    }, timeoutMs);

    redis.subscribe(`search-response:${requestId}`, (err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    redis.on('message', (channel, message) => {
      if (channel === `search-response:${requestId}`) {
        clearTimeout(timeout);
        redis.unsubscribe(`search-response:${requestId}`);

        try {
          const response = JSON.parse(message);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.data);
          }
        } catch {
          reject(new Error('Invalid search response format'));
        }
      }
    });
  });

  // Send search request to audio service
  await redis.publish('discord-bot:search-request', JSON.stringify({
    requestId,
    type: 'SEARCH_TRACKS',
    query,
    source,
    page,
    limit
  }));

  return responsePromise;
}

/**
 * GET /api/v1/search
 * Search for tracks across multiple sources
 */
router.get('/', validateSearch, asyncHandler(async (req, res) => {
  const { q: query, source, page, limit } = req.query as unknown as {
    q: string;
    source?: 'youtube' | 'spotify' | 'soundcloud' | 'all';
    page: number;
    limit: number;
  };

  try {
    logger.info({
      requestId: req.headers['x-request-id'],
      query,
      source,
      page,
      limit
    }, 'Executing track search via audio service');

    // Request search from audio service
    const searchResult = await requestSearch(query, source, page, limit);

    const response: APIResponse<SearchResult> = {
      data: searchResult,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string
    };

    logger.info({
      requestId: req.headers['x-request-id'],
      query,
      source: searchResult.source,
      resultsCount: searchResult.tracks.length,
      totalResults: searchResult.totalResults
    }, 'Search completed successfully');

    res.json(response);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      requestId: req.headers['x-request-id'],
      query,
      source
    }, 'Failed to execute search');

    throw new InternalServerError('Failed to search tracks');
  }
}));

export default router;
