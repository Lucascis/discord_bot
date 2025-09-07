import type { LLTrack, SearchFn } from './recommendations.js';

export type LLPlayer = {
  playing?: boolean;
  paused?: boolean;
  queue: { current?: LLTrack | null; tracks: LLTrack[]; add: (t: LLTrack, idx?: number) => Promise<unknown> | unknown };
  play: (opts: { clientTrack: LLTrack }) => Promise<unknown> | unknown;
  skip: () => Promise<unknown> | unknown;
};

export async function seedRelatedQueue(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const title = typeof infoBase.title === 'string' ? infoBase.title.trim() : '';
  const author = typeof infoBase.author === 'string'
    ? infoBase.author.trim()
    : (typeof (infoBase as Record<string, unknown>).artist === 'string' ? ((infoBase as Record<string, unknown>).artist as string).trim() : '');
  const uri = typeof infoBase.uri === 'string' ? infoBase.uri : '';

  // Inline import to avoid circular deps
  const { buildAutomixCandidates, normalizeTitle } = await import('./recommendations.js');
  const queries = buildAutomixCandidates(title, author, uri);
  const seenKey = new Set<string>();
  const seenTitle = new Set<string>();
  const baseNorm = normalizeTitle(title);
  const picks: LLTrack[] = [];
  for (const q of queries) {
    try {
      const res = await search(q);
      for (const t of res.tracks) {
        const info = (t.info || {}) as Record<string, unknown>;
        const uriStr = typeof info['uri'] === 'string' ? (info['uri'] as string) : undefined;
        const identStr = typeof info['identifier'] === 'string' ? (info['identifier'] as string) : undefined;
        const titleStr = typeof info['title'] === 'string' ? (info['title'] as string) : undefined;
        const key = (uriStr ?? identStr ?? titleStr ?? JSON.stringify(info));
        if (!key || seenKey.has(key)) continue;
        if (uriStr && uriStr === uri) continue;
        const candTitle = titleStr ?? '';
        const candNorm = normalizeTitle(candTitle);
        if (candNorm && (candNorm === baseNorm || seenTitle.has(candNorm))) continue;
        seenKey.add(key);
        if (candNorm) seenTitle.add(candNorm);
        picks.push(t);
        if (picks.length >= limit) break;
      }
      if (picks.length >= limit) break;
    } catch { /* next */ }
  }
  for (const t of picks) {
    await player.queue.add(t);
  }
  return picks.length;
}

