import { NextRequest, NextResponse } from 'next/server';

type LyricLine = {
  timeMs: number | null;
  text: string;
};

type LyricsResponse = {
  source: 'lrclib';
  synced: boolean;
  lines: LyricLine[];
};

type LrcLibPayload = {
  syncedLyrics?: string;
  plainLyrics?: string;
};

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const CACHE_TTL_MS = 10 * 60 * 1000;
const lyricsCache = new Map<string, { expiresAt: number; value: LyricsResponse }>();

function splitPlainLyrics(text: string): LyricLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ timeMs: null, text: line }));
}

function parseLrc(text: string): LyricLine[] {
  const output: LyricLine[] = [];
  const lines = text.split('\n');

  for (const row of lines) {
    const trimmed = row.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const lyricText = trimmed.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, '').trim();
    if (!lyricText || matches.length === 0) continue;

    for (const match of matches) {
      const minutes = Number.parseInt(match[1] ?? '0', 10);
      const seconds = Number.parseInt(match[2] ?? '0', 10);
      const millisRaw = match[3] ?? '0';
      const millis = Number.parseInt(millisRaw.padEnd(3, '0').slice(0, 3), 10);
      const timeMs = (minutes * 60_000) + (seconds * 1_000) + millis;
      output.push({ timeMs, text: lyricText });
    }
  }

  return output.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
}

function buildLyricsResponse(payload: LrcLibPayload | null): LyricsResponse | null {
  if (!payload) return null;

  const syncedRaw = typeof payload.syncedLyrics === 'string' ? payload.syncedLyrics.trim() : '';
  const plainRaw = typeof payload.plainLyrics === 'string' ? payload.plainLyrics.trim() : '';

  if (syncedRaw) {
    const syncedLines = parseLrc(syncedRaw);
    if (syncedLines.length > 0) {
      return {
        source: 'lrclib',
        synced: true,
        lines: syncedLines
      };
    }
  }

  if (plainRaw) {
    return {
      source: 'lrclib',
      synced: false,
      lines: splitPlainLyrics(plainRaw)
    };
  }

  return null;
}

async function fetchLrcLib(path: string, searchParams: URLSearchParams): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(`${LRCLIB_BASE_URL}/${path}?${searchParams.toString()}`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveLyrics(title: string, artist?: string, durationMs?: number): Promise<LyricsResponse | null> {
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (typeof durationMs === 'number' && durationMs > 0) {
    params.set('duration', Math.round(durationMs / 1000).toString());
  }

  const directHit = await fetchLrcLib('get', params);
  const directLyrics = buildLyricsResponse((directHit && typeof directHit === 'object' && !Array.isArray(directHit))
    ? directHit as LrcLibPayload
    : null);
  if (directLyrics) return directLyrics;

  const searchHit = await fetchLrcLib('search', params);
  if (!searchHit) return null;

  const searchPayload = Array.isArray(searchHit) ? searchHit : [searchHit];
  for (const candidate of searchPayload) {
    const next = buildLyricsResponse(
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as LrcLibPayload
        : null
    );
    if (next) return next;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get('title')?.trim();
  const artist = request.nextUrl.searchParams.get('artist')?.trim() || undefined;
  const durationRaw = request.nextUrl.searchParams.get('durationMs');
  const durationMs = durationRaw ? Number.parseInt(durationRaw, 10) : undefined;

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const cacheKey = [title.toLowerCase(), artist?.toLowerCase() ?? '', durationMs ?? ''].join('|');
  const cached = lyricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value);
  }

  const resolved = await resolveLyrics(title, artist, durationMs);
  if (!resolved || resolved.lines.length === 0) {
    return NextResponse.json({ source: 'lrclib', synced: false, lines: [] satisfies LyricLine[] });
  }

  lyricsCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: resolved
  });

  return NextResponse.json(resolved);
}
