import { describe, it, expect, vi } from 'vitest';
import { pickAutomixTrack, ensurePlayback, type LLPlayer, type LLTrack } from '../src/autoplay.js';

function track(uri: string, title = 't'): LLTrack { return { info: { uri, title } } as any; }

describe('autoplay flow (search + ensurePlayback)', () => {
  it('searches candidates and starts playback when idle', async () => {
    const queries: string[] = [];
    const search = async (q: string) => {
      queries.push(q);
      // Return match only when ytsearch fallback is used
      if (q.startsWith('ytsearch:')) return { tracks: [track('yt://id123', 'next')] };
      return { tracks: [] };
    };
    const pick = await pickAutomixTrack(search as any, 'Song', 'Artist', 'prev://uri');
    expect(pick).toBeTruthy();
    const play = vi.fn();
    const add = vi.fn();
    const skip = vi.fn();
    const player: LLPlayer = {
      playing: false,
      paused: false,
      queue: { current: track('prev://uri'), tracks: [], add: add as any },
      play: play as any,
      skip: skip as any,
    };
    await ensurePlayback(player, pick!);
    expect(play).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });
});

