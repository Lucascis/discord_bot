import type { Player } from 'lavalink-client';
import { searchCache } from '../cache.js';
import { PerformanceTracker, SearchThrottler } from '../performance.js';

export type SearchResultLike = { tracks: unknown[] };

export async function smartSearch(
  player: Player,
  query: string,
  userId: string,
): Promise<SearchResultLike> {
  const isUrl = /^https?:\/\//i.test(query);
  const cacheKey = `search:${query}:${userId}`;
  let res: unknown = isUrl ? undefined : searchCache.get(cacheKey);
  if (!res) {
    res = await SearchThrottler.throttle(() =>
      PerformanceTracker.measure('search', () =>
        player.search(
          { query },
          { id: userId } as { id: string },
        )
      )
    );
    if ((res?.tracks?.length ?? 0) > 0 && !isUrl && res) {
      searchCache.set(cacheKey, res, 300000);
    }
  }
  return res ?? { tracks: [] };
}

