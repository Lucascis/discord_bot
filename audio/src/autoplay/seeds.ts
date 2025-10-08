import type { LLTrack, SearchFn } from './recommendations.js';

export type LLPlayer = {
  playing?: boolean;
  paused?: boolean;
  queue: { current?: LLTrack | null; tracks: LLTrack[]; add: (t: LLTrack, idx?: number) => Promise<unknown> | unknown };
  play: (opts: { clientTrack: LLTrack }) => Promise<unknown> | unknown;
  skip: () => Promise<unknown> | unknown;
};

export type AutoplayMode = 'similar' | 'artist' | 'genre' | 'mixed';

export interface AutoplayOptions {
  mode: AutoplayMode;
  limit: number;
}

export async function seedRelatedQueue(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const title = typeof infoBase.title === 'string' ? infoBase.title.trim() : '';
  const author = typeof infoBase.author === 'string'
    ? infoBase.author.trim()
    : (typeof (infoBase as Record<string, unknown>).artist === 'string' ? ((infoBase as Record<string, unknown>).artist as string).trim() : '');
  const uri = typeof infoBase.uri === 'string' ? infoBase.uri : '';

  // Inline import to avoid circular deps
  const { buildAutomixCandidates, normalizeTitle } = await import('./recommendations.js');
  const queries = buildAutomixCandidates(title, author);
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

export async function seedByArtist(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const author = typeof infoBase.author === 'string' 
    ? infoBase.author.trim() 
    : (typeof (infoBase as Record<string, unknown>).artist === 'string' ? ((infoBase as Record<string, unknown>).artist as string).trim() : '');
  
  if (!author) return 0;

  // Search queries focused on the same artist
  const queries = [
    `spsearch:artist:"${author}"`,
    `ytmsearch:"${author}" official`,
    `ytmsearch:"${author}" -remix -bootleg`,
    `ytsearch:"${author}" official`,
    `ytsearch:"${author}" -cover -live`,
  ];

  return await executeSearchQueries(player, queries, search, limit, base);
}

export async function seedByGenre(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const title = typeof infoBase.title === 'string' ? infoBase.title.trim() : '';
  const author = typeof infoBase.author === 'string' ? infoBase.author.trim() : '';
  
  // Detect genre keywords and search accordingly
  const genreKeywords = detectGenre(title, author);
  const queries = genreKeywords.map(genre => [
    `spsearch:genre:"${genre}"`,
    `ytmsearch:"${genre}" electronic music`,
    `ytmsearch:"${genre}" deep house techno`,
    `ytsearch:"${genre}" official mix`
  ]).flat();

  return await executeSearchQueries(player, queries, search, limit, base);
}

export async function seedMixed(player: LLPlayer, base: LLTrack, search: SearchFn, limit = 10): Promise<number> {
  const artistLimit = Math.ceil(limit * 0.4); // 40% same artist
  const genreLimit = Math.ceil(limit * 0.4);  // 40% same genre  
  const similarLimit = limit - artistLimit - genreLimit; // 20% similar tracks

  const [artistCount, genreCount, similarCount] = await Promise.all([
    seedByArtist(player, base, search, artistLimit),
    seedByGenre(player, base, search, genreLimit),
    seedRelatedQueue(player, base, search, similarLimit)
  ]);

  return artistCount + genreCount + similarCount;
}

function detectGenre(title: string, author: string): string[] {
  const text = `${title} ${author}`.toLowerCase();
  const genres: string[] = [];

  // Electronic music genres detection
  const electronicGenres = {
    'house': ['house', 'deep house', 'tech house', 'progressive house'],
    'techno': ['techno', 'minimal techno', 'hard techno'],
    'trance': ['trance', 'progressive trance', 'psytrance'],
    'dubstep': ['dubstep', 'melodic dubstep', 'future bass'],
    'drum and bass': ['drum and bass', 'dnb', 'liquid dnb'],
    'ambient': ['ambient', 'chillout', 'downtempo'],
    'synthwave': ['synthwave', 'retrowave', 'darkwave'],
    'hardstyle': ['hardstyle', 'hardcore', 'gabber']
  };

  for (const [mainGenre, variations] of Object.entries(electronicGenres)) {
    if (variations.some(variation => text.includes(variation))) {
      genres.push(mainGenre);
    }
  }

  return genres.length > 0 ? genres : ['electronic', 'dance music'];
}

async function executeSearchQueries(
  player: LLPlayer,
  queries: string[],
  search: SearchFn,
  limit: number,
  base: LLTrack
): Promise<number> {
  const { normalizeTitle } = await import('./recommendations.js');
  const infoBase = (base?.info || {}) as Record<string, unknown>;
  const baseUri = typeof infoBase.uri === 'string' ? infoBase.uri : '';
  const baseTitle = typeof infoBase.title === 'string' ? infoBase.title : '';
  const baseNorm = normalizeTitle(baseTitle);
  
  const seenKey = new Set<string>();
  const seenTitle = new Set<string>();
  const picks: LLTrack[] = [];

  for (const query of queries) {
    try {
      const res = await search(query);
      for (const track of res.tracks) {
        const info = (track.info || {}) as Record<string, unknown>;
        const uriStr = typeof info['uri'] === 'string' ? (info['uri'] as string) : undefined;
        const titleStr = typeof info['title'] === 'string' ? (info['title'] as string) : undefined;
        const identStr = typeof info['identifier'] === 'string' ? (info['identifier'] as string) : undefined;
        
        const key = (uriStr ?? identStr ?? titleStr ?? JSON.stringify(info));
        if (!key || seenKey.has(key)) continue;
        if (uriStr && uriStr === baseUri) continue;
        
        const candTitle = titleStr ?? '';
        const candNorm = normalizeTitle(candTitle);
        if (candNorm && (candNorm === baseNorm || seenTitle.has(candNorm))) continue;
        
        seenKey.add(key);
        if (candNorm) seenTitle.add(candNorm);
        picks.push(track);
        
        if (picks.length >= limit) break;
      }
      if (picks.length >= limit) break;
    } catch { /* continue to next query */ }
  }

  for (const track of picks) {
    await player.queue.add(track);
  }

  return picks.length;
}

