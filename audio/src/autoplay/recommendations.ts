// Autoplay recommendations: candidates, normalization and picking logic

export type LLTrack = { info?: { title?: string; uri?: string } } & Record<string, unknown>;
export type SearchResult = { tracks: LLTrack[] };
export type SearchFn = (query: string) => Promise<SearchResult>;

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

