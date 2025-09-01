export function shouldRefillQueue(queueLen: number, threshold = 3): boolean {
  return Number.isFinite(queueLen) && queueLen < Math.max(0, threshold);
}

export type SkipState = {
  repeatMode: 'off' | 'track' | 'queue' | string | undefined;
  playing?: boolean;
  hasCurrent?: boolean;
  queueLen: number;
  autoplayEnabled: boolean;
};

export function shouldAutomixAfterSkip(s: SkipState): boolean {
  if (!s) return false;
  if ((s.repeatMode ?? 'off') !== 'off') return false;
  if (s.playing) return false;
  if (s.hasCurrent) return false;
  if (s.queueLen > 0) return false;
  return !!s.autoplayEnabled;
}

export function shouldUseSkip(queueLen: number): boolean {
  return (queueLen ?? 0) > 0;
}
