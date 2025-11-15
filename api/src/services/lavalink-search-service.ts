import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import type { SearchResult, Track } from '../types/api.js';

type LavalinkTrack = {
  info: {
    title: string;
    author: string;
    uri: string;
    identifier: string;
    length: number;
    isStream?: boolean;
    isSeekable?: boolean;
    artworkUrl?: string | null;
    sourceName?: string;
  };
};

type LavalinkResponse = {
  loadType: string;
  data?: LavalinkTrack[];
  tracks?: LavalinkTrack[];
  playlistInfo?: {
    name?: string;
    selectedTrack?: number;
  };
};

const BASE_URL = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}`;
const SEARCH_PREFIX: Record<string, string> = {
  youtube: 'ytsearch:',
  spotify: 'spsearch:',
  soundcloud: 'scsearch:'
};

function buildIdentifier(query: string, source?: string): string {
  const trimmed = query.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  if (isUrl) {
    return trimmed;
  }

  if (!source || source === 'all') {
    return `ytsearch:${trimmed}`;
  }

  const prefix = SEARCH_PREFIX[source] ?? SEARCH_PREFIX.youtube;
  return `${prefix}${trimmed}`;
}

function mapLavalinkTrack(track: LavalinkTrack): Track {
  const info = track.info ?? {
    title: 'Unknown track',
    author: 'Unknown artist',
    uri: '',
    identifier: '',
    length: 0
  };

  const source = (info.sourceName as Track['source']) ?? 'youtube';

  return {
    title: info.title,
    author: info.author,
    uri: info.uri,
    identifier: info.identifier,
    duration: info.length,
    isSeekable: info.isSeekable ?? true,
    isStream: info.isStream ?? false,
    thumbnail: info.artworkUrl ?? undefined,
    source,
    requester: undefined
  };
}

export async function searchTracksViaLavalink(
  query: string,
  source: 'youtube' | 'spotify' | 'soundcloud' | 'all' = 'all',
  page: number,
  limit: number,
  abortSignal?: AbortSignal
): Promise<SearchResult> {
  const identifier = buildIdentifier(query, source);
  const url = new URL('/v4/loadtracks', BASE_URL);
  url.searchParams.set('identifier', identifier);

  logger.debug({
    identifier,
    source,
    page,
    limit
  }, 'Executing Lavalink search');

  const response = await fetch(url, {
    headers: {
      Authorization: env.LAVALINK_PASSWORD
    },
    signal: abortSignal
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn({
      status: response.status,
      statusText: response.statusText,
      body: text
    }, 'Lavalink search request failed');
    throw new Error('Search backend error');
  }

  const payload = await response.json() as LavalinkResponse;
  const trackList = payload.data ?? payload.tracks ?? [];
  const mappedTracks = trackList.map(mapLavalinkTrack);
  const startIndex = (page - 1) * limit;
  const pagedTracks = mappedTracks.slice(startIndex, startIndex + limit);

  return {
    query,
    source,
    tracks: pagedTracks,
    totalResults: mappedTracks.length,
    playlistInfo: payload.playlistInfo
      ? {
          name: payload.playlistInfo.name ?? '',
          author: '',
          uri: identifier,
          trackCount: mappedTracks.length
        }
      : undefined
  };
}
