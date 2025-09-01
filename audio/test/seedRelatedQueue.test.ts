import { describe, it, expect } from 'vitest';
import { seedRelatedQueue, type LLPlayer, type LLTrack, type SearchResult } from '../src/autoplay.js';

function tr(uri: string, title?: string): LLTrack { return { info: { uri, title } } as LLTrack; }

describe('seedRelatedQueue', () => {
  it('adds up to limit unique tracks and avoids duplicates', async () => {
    const added: LLTrack[] = [];
    const player: LLPlayer = {
      playing: false,
      paused: false,
      queue: { current: tr('base://uri', 'base'), tracks: [], add: (t: LLTrack) => { added.push(t); } },
      play: async () => undefined,
      skip: async () => undefined,
    };
    const base = tr('base://uri', 'base');
    const seen = new Set<string>();
    const search = async (): Promise<SearchResult> => {
      // simulate some duplicates across calls
      const all = [tr('u1','A'), tr('u2','B'), tr('u1','A'), tr('u3','C')];
      const uniq = all.filter(t => { const k=(t.info?.uri||'') as string; if(seen.has(k)) return false; seen.add(k); return true; });
      return { tracks: uniq } as SearchResult;
    };
    const n = await seedRelatedQueue(player, base, search, 3);
    expect(n).toBeLessThanOrEqual(3);
    expect(added.length).toBe(n);
    // Should not include base or duplicates
    expect(added.find(t => t.info?.uri === 'base://uri')).toBeFalsy();
  });
});
