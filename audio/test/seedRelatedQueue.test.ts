import { describe, it, expect, vi } from 'vitest';
import { seedRelatedQueue, type LLPlayer, type LLTrack } from '../src/autoplay.js';

function tr(uri: string, title?: string): LLTrack { return { info: { uri, title } } as any; }

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
    const search = async (_q: string) => {
      // simulate some duplicates across calls
      const all = [tr('u1','A'), tr('u2','B'), tr('u1','A'), tr('u3','C')];
      const uniq = all.filter(t => { const k=(t.info?.uri||'') as string; if(seen.has(k)) return false; seen.add(k); return true; });
      return { tracks: uniq } as any;
    };
    const n = await seedRelatedQueue(player, base, search as any, 3);
    expect(n).toBeLessThanOrEqual(3);
    expect(added.length).toBe(n);
    // Should not include base or duplicates
    expect(added.find(t => t.info?.uri === 'base://uri')).toBeFalsy();
  });
});

