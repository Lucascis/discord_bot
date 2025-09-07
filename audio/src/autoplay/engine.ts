import type { LLTrack } from './recommendations.js';
import type { LLPlayer } from './seeds.js';

export function isBlockReason(reason?: string | null): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return r === 'replaced' || r === 'stopped' || r === 'cleanup' || r === 'load_failed' || r === 'loadfailed';
}

export async function ensurePlayback(player: LLPlayer, track: LLTrack): Promise<'played' | 'queued'> {
  if (!player.playing && !player.paused) {
    await player.play({ clientTrack: track });
    return 'played';
  }
  await player.queue.add(track);
  if (!player.playing && !player.paused) {
    try { await player.skip(); } catch { /* ignore */ }
  }
  return 'queued';
}

// Re-exports for convenience
export { buildAutomixCandidates, normalizeTitle, pickAutomixTrack } from './recommendations.js';
export { seedRelatedQueue, type LLPlayer } from './seeds.js';

