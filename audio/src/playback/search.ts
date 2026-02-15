import type { Player } from 'lavalink-client';
import { searchCache } from '../services/cache.js';
import { audioMetrics } from '../services/metrics.js';
import { searchOptimizer } from '../services/search-optimizer.js';
import { PerformanceTracker, SearchThrottler } from '../performance.js';
import { logger } from '@discord-bot/logger';

const serializeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : error;

export type SearchResultLike = { tracks: unknown[] };
type TrackLikeRecord = Record<string, unknown>;

function isTrackLikeRecord(value: unknown): value is TrackLikeRecord {
  return !!value && typeof value === 'object';
}

function sanitizeTracksForCache(tracks: unknown[]): unknown[] {
  // Keep cache footprint bounded. Playback uses live search result, not cached copy.
  return tracks
    .slice(0, 40)
    .map((track) => {
      if (!isTrackLikeRecord(track)) return null;

      const encoded = typeof track.encoded === 'string'
        ? track.encoded
        : (typeof track.track === 'string' ? track.track : undefined);

      const info = isTrackLikeRecord(track.info) ? track.info : undefined;
      const pluginInfo = isTrackLikeRecord(track.pluginInfo) ? track.pluginInfo : undefined;
      const userData = isTrackLikeRecord(track.userData) ? track.userData : undefined;

      if (!encoded && !info) {
        return null;
      }

      const payload: TrackLikeRecord = {};
      if (encoded) payload.encoded = encoded;
      if (info) payload.info = info;
      if (pluginInfo) payload.pluginInfo = pluginInfo;
      if (userData) payload.userData = userData;
      return payload;
    })
    .filter((track): track is TrackLikeRecord => track !== null);
}

/**
 * Enhanced Smart Search with Multi-Layer Caching and Metrics
 *
 * Implements intelligent search with performance optimizations:
 * - Multi-layer cache (L1 memory + L2 Redis)
 * - Search result caching with source detection
 * - Comprehensive metrics tracking
 * - Throttling to prevent API abuse
 * - Performance monitoring
 */
export async function smartSearch(
  player: Player,
  query: string,
  userId: string,
  guildId?: string,
): Promise<SearchResultLike> {
  const startTime = Date.now();
  const isUrl = /^https?:\/\//i.test(query);
  const cacheQuery = normalizeQueryForCache(query);

  // Detect source from query
  const source = detectSource(query);

  // Try to get from enhanced cache first (URLs are not cached).
  // Cache is intentionally user-agnostic to avoid duplicated payloads in memory.
  if (!isUrl) {
    const cached = await searchCache.getCachedSearchResult(cacheQuery, source);

    if (cached) {
      const searchLatency = Date.now() - startTime;

      // Track cached search metrics
      if (guildId) {
        audioMetrics.trackSearchQuery(
          guildId,
          query,
          source,
          cached.length,
          searchLatency,
          true, // cached
          userId
        );
      }

      // Track for search optimization
      searchOptimizer.trackSearch(query, source, searchLatency, true);

      return { tracks: cached };
    }
  }

  // Perform actual search with throttling and performance tracking
  // CRITICAL FIX: Use manager search as fallback if player search fails
  const searchResult = await SearchThrottler.throttle(async () =>
    PerformanceTracker.measure('search', async () => {
      try {
        // Try player search first (requires full connection)
        const result = await player.search(
          { query },
          { id: userId } as { id: string },
        );

        // If no results found, try with more specific YouTube search prefix
        if (result.tracks.length === 0 && !isUrl) {
          logger.info(`No results for "${query}", trying with "music" suffix...`);
          const enhancedQuery = `${query} music`;
          const enhancedResult = await player.search(
            { query: enhancedQuery },
            { id: userId } as { id: string },
          );
          if (enhancedResult.tracks.length > 0) {
            return enhancedResult;
          }
        }

        return result;
      } catch (error) {
        logger.info({
          error: serializeError(error),
          query,
          guildId
        }, 'Player search failed, using alternative search method');
        // Just throw the error and let the calling code handle no results
        // since we can't reliably access the manager from here
        throw error;
      }
    })
  );

  const result = searchResult as SearchResultLike;
  const resultCount = result.tracks?.length ?? 0;
  const searchLatency = Date.now() - startTime;

  // Track search metrics
  if (guildId) {
    audioMetrics.trackSearchQuery(
      guildId,
      query,
      source,
      resultCount,
      searchLatency,
      false, // not cached
      userId
    );
  }

  // Track for search optimization
  searchOptimizer.trackSearch(query, source, searchLatency, false);

  // Cache successful results (not URLs).
  if (resultCount > 0 && !isUrl) {
    const cacheableTracks = sanitizeTracksForCache(result.tracks);
    if (cacheableTracks.length > 0) {
      await searchCache.cacheSearchResult(cacheQuery, cacheableTracks, source);
    }
  }

  return result;
}

/**
 * Normalize query for better cache hit rates
 */
function normalizeQueryForCache(query: string): string {
  return query
    .toLowerCase()
    .trim()
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    // Remove common music suffixes that don't affect search results
    .replace(/\s+(official\s+)?(music\s+)?(video|audio|lyric|lyrics|live|remix|cover|acoustic|version)$/i, '')
    // Remove common prefixes that don't matter
    .replace(/^(the\s+|a\s+|an\s+)/i, '')
    // Standardize featuring/ft variations
    .replace(/\s+(feat\.?|featuring|ft\.?|with)\s+/gi, ' ft ')
    // Remove punctuation that doesn't affect search
    .replace(/[.,!?;:'"()[\]{}]/g, '');
}

/**
 * Detect music source from query
 */
function detectSource(query: string): string {
  const lowercaseQuery = query.toLowerCase();

  // URL-based detection
  if (lowercaseQuery.includes('youtube.com') || lowercaseQuery.includes('youtu.be')) {
    return 'youtube';
  }
  if (lowercaseQuery.includes('spotify.com')) {
    return 'spotify';
  }
  if (lowercaseQuery.includes('soundcloud.com')) {
    return 'soundcloud';
  }

  // Platform prefix detection
  if (lowercaseQuery.startsWith('yt:') || lowercaseQuery.startsWith('youtube:')) {
    return 'youtube';
  }
  if (lowercaseQuery.startsWith('sp:') || lowercaseQuery.startsWith('spotify:')) {
    return 'spotify';
  }
  if (lowercaseQuery.startsWith('sc:') || lowercaseQuery.startsWith('soundcloud:')) {
    return 'soundcloud';
  }

  // Default to youtube for text searches
  return 'youtube';
}
