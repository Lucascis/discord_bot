// Autoplay recommendations: candidates, normalization and picking logic

export type LLTrack = { info?: { title?: string; uri?: string } } & Record<string, unknown>;
export type SearchResult = { tracks: LLTrack[] };
export type SearchFn = (query: string) => Promise<SearchResult>;

export function buildAutomixCandidates(titleRaw: string, authorRaw: string): string[] {
  const title = (titleRaw ?? '').trim();
  const author = (authorRaw ?? '').trim();
  const candidates: string[] = [];
  
  // Prioritize official channels and avoid aggregator channels
  if (author && title) {
    // Spotify search (highest quality, official releases) - highest priority
    candidates.push(`spsearch:"${author}" "${title}"`);
    candidates.push(`spsearch:${author} ${title}`);
    
    // YouTube Music searches (prioritize official releases) - high priority
    candidates.push(`ytmsearch:"${author}" "${title}" official`);
    candidates.push(`ytmsearch:"${author}" "${title}"`);
    candidates.push(`ytmsearch:"${author} ${title}" official`);
    candidates.push(`ytmsearch:"${author} - ${title}"`); // Hyphen format common in official uploads
    candidates.push(`ytmsearch:${author} ${title}`);
    
    // Regular YouTube searches with quality filters - medium priority
    candidates.push(`ytsearch:"${author}" "${title}" official`);
    candidates.push(`ytsearch:"${author}" "${title}" -bootleg -cover`); // Allow remixes, block low-quality content
    candidates.push(`ytsearch:"${author} ${title}" official`);
    candidates.push(`ytsearch:"${author} ${title}" remix`); // Include remixes for electronic music
    candidates.push(`ytsearch:"${author} - ${title}"`);
    
    // Broader searches as last resort
    candidates.push(`ytsearch:${author} ${title}`);
  } else if (title) {
    // If only title is available, search more broadly but still prioritize official
    candidates.push(`spsearch:"${title}"`);
    candidates.push(`ytmsearch:"${title}" official`);
    candidates.push(`ytsearch:"${title}" official -bootleg -cover`); // Allow remixes
    candidates.push(`ytmsearch:${title}`);
    candidates.push(`ytsearch:${title}`);
  }
  
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

// Blacklisted channel names that provide low-quality or aggregated content
const BLACKLISTED_CHANNELS = [
  'metadata',
  'various artists',
  'auto-generated',
  'topic - auto-generated',
  'youtube music',
  'generated automatically',
  'artis lain',
  'compilation',
  'free music',
  'no copyright music',
  'copyright free',
  'soundcloud',
  'spotify',
  'deezer',
  'apple music',
  'amazon music',
  'tidal',
  'pandora',
  'youtube premium',
  'streaming service',
  'music library',
  'playlist',
  'mixtape',
  'dj mix',
  'unofficial',
  'bootleg',
  'leaked',
  'preview',
  'radio rip',
  'live rip',
  'tv rip'
];

function isChannelBlacklisted(author?: string): boolean {
  if (!author) return false;
  const authorLower = author.toLowerCase().trim();
  
  // Check exact matches or partial matches for blacklisted terms
  const isBlacklisted = BLACKLISTED_CHANNELS.some(blocked => {
    return authorLower.includes(blocked) || 
           authorLower.startsWith(blocked) ||
           authorLower.endsWith(blocked) ||
           authorLower === blocked;
  });
  
  // Additional patterns to detect auto-generated and low-quality content
  const suspiciousPatterns = [
    /- topic$/,           // YouTube auto-generated topic channels
    /\d{4,}/,             // Channels with many numbers (often spam/auto-generated)
    /^[A-Z\s]+$/,         // ALL CAPS channel names (often spam)
    /music.*channel/,     // Generic music channel names
    /^the .* channel$/,   // "The [Something] Channel" pattern
    /official.*music/,    // Fake official music channels
    /\bvevo\b/,           // VEVO channels (aggregators)
    /\btopic\b/,          // Topic channels
    /\bmix\b.*\bplaylist\b/ // Mix playlist channels
  ];
  
  const matchesSuspiciousPattern = suspiciousPatterns.some(pattern => 
    pattern.test(authorLower)
  );
  
  return isBlacklisted || matchesSuspiciousPattern;
}

export async function pickAutomixTrack(search: SearchFn, title: string, author: string, uri: string): Promise<LLTrack | undefined> {
  const candidates = buildAutomixCandidates(title, author);
  const baseNorm = normalizeTitle(title);
  for (const q of candidates) {
    try {
      const res = await search(q);
      const pick = res.tracks.find((t) => {
        const info = t.info;
        if (!info) return false;
        if (info.uri && info.uri === uri) return false;
        
        // Filter out blacklisted channels (like Metadata, auto-generated content)
        const trackAuthor = (info as { author?: string }).author;
        if (isChannelBlacklisted(trackAuthor)) return false;
        
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

