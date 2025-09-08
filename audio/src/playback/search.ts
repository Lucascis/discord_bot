import type { Player } from 'lavalink-client';
import { searchCache, type SearchResult } from '../cache.js';
import { PerformanceTracker, SearchThrottler } from '../performance.js';

export type SearchResultLike = { tracks: unknown[] };

export async function smartSearch(
  player: Player,
  query: string,
  userId: string,
): Promise<SearchResultLike> {
  const isUrl = /^https?:\/\//i.test(query);
  const cacheKey = `search:${query}:${userId}`;
  const cached: SearchResult | undefined = isUrl ? undefined : searchCache.get(cacheKey);
  if (!cached) {
    const searchResult = await SearchThrottler.throttle(() =>
      PerformanceTracker.measure('search', () =>
        player.search(
          { query },
          { id: userId } as { id: string },
        )
      )
    );
    const result = searchResult as SearchResultLike;
    if ((result.tracks?.length ?? 0) > 0 && !isUrl) {
      // Store in cache with proper SearchResult structure
      const cacheableResult: SearchResult = {
        tracks: result.tracks as SearchResult['tracks'],
        source: 'lavalink',
        query,
        timestamp: Date.now()
      };
      searchCache.set(cacheKey, cacheableResult, 300000);
    }
    return result;
  }
  return cached;
}

