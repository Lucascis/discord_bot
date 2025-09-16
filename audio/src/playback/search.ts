import type { Player } from 'lavalink-client';
import { searchCache } from '../services/cache.js';
import { audioMetrics } from '../services/metrics.js';
import { PerformanceTracker, SearchThrottler } from '../performance.js';

export type SearchResultLike = { tracks: unknown[] };

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

  // Detect source from query
  const source = detectSource(query);

  // Try to get from enhanced cache first (URLs are not cached)
  if (!isUrl) {
    const cached = await searchCache.getCachedSearchResult(query, source, userId);
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

      return { tracks: cached };
    }
  }

  // Perform actual search with throttling and performance tracking
  const searchResult = await SearchThrottler.throttle(() =>
    PerformanceTracker.measure('search', () =>
      player.search(
        { query },
        { id: userId } as { id: string },
      )
    )
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

  // Cache successful results (not URLs)
  if (resultCount > 0 && !isUrl) {
    await searchCache.cacheSearchResult(query, result.tracks, source, userId);
  }

  return result;
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

