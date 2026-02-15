import { apiFetch } from './api-client';

const getPublicApiBase = (): string => {
  // Browser requests go through Next.js BFF route handlers.
  return typeof window === 'undefined'
    ? (process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://api:3000')
    : '';
};

export type NowPlayingState = {
  guildId: string;
  title: string;
  durationMs: number;
  positionMs: number;
  isStream: boolean;
  paused: boolean;
  repeatMode: 'off' | 'track' | 'queue';
  queueLen: number;
  hasTrack: boolean;
  canSeek: boolean;
  volume: number;
  autoplay: boolean;
  autoplayMode: 'off' | 'similar' | 'artist' | 'genre' | 'mixed';
  textChannelId?: string;
  voiceChannelId?: string;
  filter?: {
    id: string;
    label: string;
    description: string;
  };
  uri?: string;
  author?: string;
  artworkUrl?: string;
  updatedAt?: number;
  streamable?: boolean;
};

export type PlayerActionPayload =
  | { action: 'toggle' }
  | { action: 'skip' }
  | { action: 'stop' }
  | { action: 'shuffle' }
  | { action: 'clear' }
  | { action: 'previous' }
  | { action: 'mute' }
  | { action: 'volume'; value: number };

export type ActiveInstance = {
  voiceChannelId: string;
  textChannelId: string;
};

export async function getNowPlaying(guildId: string, apiKey?: string): Promise<NowPlayingState | null> {
  if (!guildId) return null;
  return await apiFetch<NowPlayingState | null>(`/api/v1/player/${guildId}/now-playing`, { apiKey });
}

export async function getActiveInstances(
  guildId: string,
  apiKey?: string
): Promise<{ instances: ActiveInstance[]; limit: number; availableSlots: number }> {
  if (!guildId) return { instances: [], limit: 0, availableSlots: 0 };
  return await apiFetch<{ instances: ActiveInstance[]; limit: number; availableSlots: number }>(
    `/api/v1/player/${guildId}/instances`,
    { apiKey }
  );
}

export async function sendPlayerCommand(
  guildId: string,
  payload: PlayerActionPayload,
  apiKey?: string
): Promise<void> {
  if (!guildId) return;
  await apiFetch(`/api/v1/player/${guildId}/controls`, {
    method: 'POST',
    body: JSON.stringify(payload),
    apiKey
  });
}

export function subscribeToPlayerEvents(
  guildId: string | null,
  onState: (state: NowPlayingState | null) => void,
  _panelApiKey?: string
): () => void {
  if (typeof window === 'undefined' || !guildId) {
    return () => { };
  }
  let closed = false;
  let source: EventSource | null = null;

  const connect = () => {
    if (closed) return;
    const url = `${getPublicApiBase()}/api/v1/player/${guildId}/events`;
    source = new EventSource(url);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { state?: NowPlayingState | null };
        const nextState = Object.prototype.hasOwnProperty.call(payload, 'state')
          ? payload.state
          : (payload as unknown as NowPlayingState | null);
        if (nextState) {
          onState(nextState.updatedAt ? nextState : { ...nextState, updatedAt: Date.now() });
        } else {
          onState(null);
        }
      } catch (error) {
        console.warn('Failed to parse player event', error);
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (!closed) {
        setTimeout(connect, 2000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    source?.close();
  };
}

export async function requestStreamToken(
  guildId: string,
  apiKey?: string
): Promise<{ token: string; expires: number }> {
  return await apiFetch<{ token: string; expires: number }>(`/api/v1/player/${guildId}/stream-token`, {
    method: 'POST',
    apiKey
  });
}

export function buildStreamUrl(guildId: string, token: string, _panelApiKey?: string): string {
  const params = new URLSearchParams({ token });
  return `${getPublicApiBase()}/api/v1/player/${guildId}/stream?${params.toString()}`;
}

export async function summonBot(
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
  apiKey?: string
): Promise<void> {
  if (!guildId || !voiceChannelId || !textChannelId) return;
  await apiFetch(`/api/v1/panel/guilds/${guildId}/summon`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify({ voiceChannelId, textChannelId })
  });
}

export async function playTrack(
  guildId: string,
  payload: { query: string; mode?: 'play' | 'playnext' | 'playnow'; userId: string; voiceChannelId?: string; textChannelId?: string },
  apiKey?: string
): Promise<void> {
  if (!guildId || !payload.userId) return;
  await apiFetch(`/api/v1/player/${guildId}/play`, {
    method: 'POST',
    apiKey,
    body: JSON.stringify(payload)
  });
}
