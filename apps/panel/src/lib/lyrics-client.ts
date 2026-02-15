export type LyricsLine = {
  timeMs: number | null;
  text: string;
};

export type LyricsPayload = {
  source: string;
  synced: boolean;
  lines: LyricsLine[];
};

export async function getLyrics(payload: {
  title?: string;
  artist?: string;
  durationMs?: number;
}): Promise<LyricsPayload | null> {
  if (!payload.title) return null;

  const params = new URLSearchParams({
    title: payload.title
  });

  if (payload.artist) params.set('artist', payload.artist);
  if (typeof payload.durationMs === 'number' && payload.durationMs > 0) {
    params.set('durationMs', payload.durationMs.toString());
  }

  try {
    const response = await fetch(`/api/lyrics?${params.toString()}`);
    if (!response.ok) return null;
    const body = await response.json() as LyricsPayload;
    if (!Array.isArray(body.lines)) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}
