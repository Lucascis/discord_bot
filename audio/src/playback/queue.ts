import type { Player, Track } from 'lavalink-client';
import type { LLTrack } from '../autoplay/recommendations.js';

export async function enqueueOrPlay(player: Player, track: LLTrack): Promise<'played' | 'queued'> {
  if (!player.playing && !player.paused && !player.queue.current) {
    await player.play({ clientTrack: track as unknown as Track });
    return 'played';
  }
  await player.queue.add(track as unknown as Track, 0);
  return 'queued';
}

