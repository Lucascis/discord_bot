import { Router, type Router as ExpressRouter } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validateSearch } from '../../middleware/validation.js';
import { InternalServerError } from '../../middleware/error-handler.js';
import type { APIResponse, SearchResult } from '../../types/api.js';
import { logger } from '@discord-bot/logger';
import { searchTracksViaLavalink } from '../../services/lavalink-search-service.js';

/**
 * Search API Router
 *
 * Implements REST endpoints for track search functionality
 * Using Lavalink's REST API directly per official documentation:
 * https://lavalink.dev/api/rest.html#operation/loadTracks
 */

const router: ExpressRouter = Router();

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

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    let searchResult: SearchResult;

    try {
      searchResult = await searchTracksViaLavalink(
        query,
        source || 'all',
        page || 1,
        limit || 20,
        abortController.signal
      );
    } finally {
      clearTimeout(timeout);
    }

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
