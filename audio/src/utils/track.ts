import { Track, UnresolvedTrack } from 'lavalink-client';
import { LLTrack } from '../autoplay/recommendations.js';

export type TrackInfo = {
    title?: string;
    author?: string;
    uri?: string;
    artworkUrl?: string;
    duration?: number;
    identifier?: string;
    sourceName?: string;
};

export function extractTrackInfo(track: Track | UnresolvedTrack | LLTrack | null | undefined): TrackInfo | undefined {
    if (track && typeof track === 'object' && 'info' in track) {
        const { info } = track as Track & { info?: TrackInfo };
        if (info) {
            const artworkUrl = info.artworkUrl ?? inferYouTubeArtwork(info.uri, info.identifier);
            return {
                title: info.title,
                author: info.author,
                uri: info.uri,
                artworkUrl,
                duration: info.duration,
                identifier: info.identifier,
                sourceName: (info as { sourceName?: string }).sourceName
            };
        }
    }
    return undefined;
}

function inferYouTubeArtwork(uri?: string, identifier?: string): string | undefined {
    const candidateId = identifier ?? extractYouTubeId(uri);
    if (!candidateId) return undefined;
    return `https://i.ytimg.com/vi/${candidateId}/hqdefault.jpg`;
}

function extractYouTubeId(uri?: string): string | undefined {
    if (!uri || typeof uri !== 'string') return undefined;
    try {
        const url = new URL(uri);
        if (url.hostname.includes('youtube.com')) {
            return url.searchParams.get('v') ?? undefined;
        }
        if (url.hostname === 'youtu.be') {
            const id = url.pathname.replace('/', '').trim();
            return id || undefined;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

export function isResolvedTrack(track: Track | UnresolvedTrack | null | undefined): track is Track {
    const info = extractTrackInfo(track);
    return !!info && typeof info.identifier === 'string';
}
