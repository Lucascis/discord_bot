import { describe, it, expect, vi } from 'vitest';
import { ensurePlayback, type LLPlayer, type LLTrack } from '../src/autoplay.js';

function mkTrack(uri = 'u1'): LLTrack { return { info: { title: 't', uri } } as any; }

describe('ensurePlayback', () => {
  it('plays immediately when not playing and not paused (even if current still set)', async () => {
    const play = vi.fn();
    const add = vi.fn();
    const skip = vi.fn();
    const player: LLPlayer = {
      playing: false,
      paused: false,
      queue: { current: mkTrack('old'), tracks: [], add: add as any },
      play: play as any,
      skip: skip as any,
    };
    const res = await ensurePlayback(player, mkTrack('new'));
    expect(res).toBe('played');
    expect(play).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
    expect(skip).not.toHaveBeenCalled();
  });

  it('queues when already playing', async () => {
    const play = vi.fn();
    const add = vi.fn();
    const skip = vi.fn();
    const player: LLPlayer = {
      playing: true,
      paused: false,
      queue: { current: mkTrack('cur'), tracks: [], add: add as any },
      play: play as any,
      skip: skip as any,
    };
    const res = await ensurePlayback(player, mkTrack('next'));
    expect(res).toBe('queued');
    expect(add).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });
});

