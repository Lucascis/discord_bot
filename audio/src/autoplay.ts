export function isBlockReason(reason?: string | null): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return r === 'replaced' || r === 'stopped' || r === 'cleanup' || r === 'load_failed' || r === 'loadfailed';
}

export function buildAutomixCandidates(titleRaw: string, authorRaw: string, uri: string): string[] {
  const title = (titleRaw ?? '').trim();
  const author = (authorRaw ?? '').trim();
  const candidates: string[] = [];
  if (author || title) candidates.push(`ytmsearch:"${author} ${title}" official`);
  if (author || title) candidates.push(`ytmsearch:${title} ${author} topic`);
  if (uri.includes('open.spotify.com/track')) {
    if (author || title) candidates.push(`spsearch:${author} ${title}`);
  }
  if (author || title) candidates.push(`ytmsearch:${author} ${title}`);
  // Fallbacks if YTM/LavaSrc are not available
  if (author || title) candidates.push(`ytsearch:"${author} ${title}" official`);
  if (author || title) candidates.push(`ytsearch:${title} ${author} topic`);
  if (author || title) candidates.push(`ytsearch:${author} ${title}`);
  return candidates;
}

// Minimal interfaces for testability (duck-typed from lavalink-client)
export type LLTrack = { info?: { title?: string; uri?: string } } & Record<string, unknown>;
export type SearchResult = { tracks: LLTrack[] };
export type SearchFn = (query: string) => Promise<SearchResult>;

export async function pickAutomixTrack(search: SearchFn, title: string, author: string, uri: string): Promise<LLTrack | undefined> {
  const candidates = buildAutomixCandidates(title, author, uri);
  const baseNorm = normalizeTitle(title);
  for (const q of candidates) {
    try {
      const res = await search(q);
      const pick = res.tracks.find((t) => {
        const info = t.info;
        if (!info) return false;
        if (info.uri && info.uri === uri) return false;
        if (info.title && title) {
          const candNorm = normalizeTitle(String(info.title));
          if (candNorm === baseNorm) return false;
        }
        return true;
      });
      if (pick) return pick;
    } catch { /* try next */ }
  }
  return undefined;
}

export type LLPlayer = {
  playing?: boolean;
  paused?: boolean;
  queue: { current?: LLTrack | null; tracks: LLTrack[]; add: (t: LLTrack, idx?: number) => Promise<unknown> | unknown };
  play: (opts: { clientTrack: LLTrack }) => Promise<unknown> | unknown;
  skip: () => Promise<unknown> | unknown;
};

// Ensure the chosen track actually starts. If not playing, prefer play(); otherwise add to queue.
export async function ensurePlayback(player: LLPlayer, track: LLTrack): Promise<'played' | 'queued'> {
  if (!player.playing && !player.paused) {
    await player.play({ clientTrack: track });
    return 'played';
  }
  await player.queue.add(track);
  // Best-effort: if still not playing shortly after adding, try skip to start next
  if (!player.playing && !player.paused) {
    try { await player.skip(); } catch { /* ignore */ }
  }
  return 'queued';
}

// Seed related tracks into queue on first play
export async function seedRelatedQueue(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const title = typeof infoBase.title === 'string' ? infoBase.title.trim() : '';
  const author = typeof infoBase.author === 'string'
    ? infoBase.author.trim()
    : (typeof (infoBase as Record<string, unknown>).artist === 'string' ? ((infoBase as Record<string, unknown>).artist as string).trim() : '');
  const uri = typeof infoBase.uri === 'string' ? infoBase.uri : '';
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

// Normalize titles to avoid near-duplicates like different remixes/edits wording
export function normalizeTitle(raw: string): string {
  let s = (raw || '').toLowerCase();
  // remove content in brackets and parentheses
  s = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
  // remove trailing segments that indicate remix/edit/version (and their leading text)
  s = s.replace(/[-–—:\s]+.*\b(remix|rework|edit|mix|version|vip|extended|radio|club|dub|bootleg)\b.*$/g, ' ');
  // remove featuring segments first (token + following words)
  s = s.replace(/(featuring|feat\.?|ft\.)\s+[\w\s.-]+/g, ' ');
  // remove tokens commonly used for remixes/versions
  s = s.replace(/\b(remix|rework|edit|mix|version|vip|extended|radio|club|dub|bootleg|feat\.?|ft\.)\b/g, ' ');
  // collapse whitespace and punctuation noise
  s = s.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
