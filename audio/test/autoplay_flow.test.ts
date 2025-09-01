import { describe, it, expect, vi } from 'vitest';
import { pickAutomixTrack, ensurePlayback, type LLPlayer, type LLTrack, type SearchResult } from '../src/autoplay.js';

function track(uri: string, title = 't'): LLTrack { return { info: { uri, title } } as LLTrack; }

describe('autoplay flow (search + ensurePlayback)', () => {
  it('searches candidates and starts playback when idle', async () => {
    const queries: string[] = [];
    const search = async (q: string): Promise<SearchResult> => {
      queries.push(q);
      // Return match only when ytsearch fallback is used
      if (q.startsWith('ytsearch:')) return { tracks: [track('yt://id123', 'next')] } as SearchResult;
      return { tracks: [] } as SearchResult;
    };
    const pick = await pickAutomixTrack(search, 'Song', 'Artist', 'prev://uri');
    expect(pick).toBeTruthy();
    const play = vi.fn();
    const add = vi.fn();
    const skip = vi.fn();
    const player: LLPlayer = {
      playing: false,
      paused: false,
      queue: { current: track('prev://uri'), tracks: [], add: async (t: LLTrack) => { add(t); } },
      play: async (opts: { clientTrack: LLTrack }) => { play(opts); },
      skip: async () => { skip(); },
    };
    await ensurePlayback(player, pick!);
    expect(play).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });
});
