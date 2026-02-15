'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { playTrack } from '@/lib/player-client';
import { apiFetch } from '@/lib/api-client';

type TrackSummary = {
  identifier: string;
  title: string;
  author?: string;
  uri?: string;
  duration: number;
  source: string;
};

interface Props {
  guildId?: string;
  panelApiKey: string;
  userId?: string;
  activeVoiceChannelId?: string;
  activeTextChannelId?: string;
  disabled?: boolean;
  defaultSearchSource?: 'youtube' | 'spotify' | 'soundcloud';
}

export function TrackSearch({
  guildId,
  panelApiKey,
  userId,
  activeVoiceChannelId,
  activeTextChannelId,
  disabled,
  defaultSearchSource
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canControl = Boolean(guildId && userId);

  const runSearch = useCallback(async (value: string) => {
    if (!value || value.length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const source = defaultSearchSource ?? 'all';
      const response = await apiFetch<{ tracks: TrackSummary[] }>(`/api/v1/search?q=${encodeURIComponent(value)}&source=${encodeURIComponent(source)}&limit=5`, {
        apiKey: panelApiKey
      });
      setResults(response.tracks);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'No pudimos buscar canciones.');
    } finally {
      setLoading(false);
    }
  }, [panelApiKey, defaultSearchSource]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(query.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  const disabledReason = useMemo(() => {
    if (!canControl) return 'Ingresá con tu cuenta de Discord para controlar la música.';
    if (!activeVoiceChannelId || !activeTextChannelId) {
      return 'Invocá el bot a un canal desde el panel para enviar canciones.';
    }
    return null;
  }, [canControl, activeVoiceChannelId, activeTextChannelId]);

  const handlePlay = async (track: TrackSummary, mode: 'play' | 'playnext' | 'playnow') => {
    if (!guildId || !userId) return;
    try {
      await playTrack(guildId, {
        query: track.uri ?? track.title,
        mode,
        userId,
        voiceChannelId: activeVoiceChannelId,
        textChannelId: activeTextChannelId
      }, panelApiKey);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : 'No pudimos enviar la canción.');
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Buscar catálogo</p>
          <h2 className="text-2xl font-semibold text-white">Agregar canciones al instante</h2>
        </div>
        {disabledReason && (
          <span className="text-xs text-amber-200">{disabledReason}</span>
        )}
      </div>
      <div className="mt-4">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Escribí un artista, track o pegá una URL…"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-brand-400 focus:outline-none"
          disabled={disabled || !canControl}
        />
      </div>
      {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-white/60">Buscando…</p>}
        {!loading && results.map((track) => (
          <article key={`${track.identifier}-${track.uri}`} className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/80">
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{track.title}</p>
              <p className="text-xs text-white/60">{track.author ?? 'Autor desconocido'}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => void handlePlay(track, 'play')}
                disabled={disabled || !canControl || !activeVoiceChannelId}
                className="rounded-full bg-brand-500 px-4 py-1 font-semibold text-white transition hover:bg-brand-400 disabled:opacity-40"
              >
                Reproducir
              </button>
              <button
                type="button"
                onClick={() => void handlePlay(track, 'playnext')}
                disabled={disabled || !canControl || !activeVoiceChannelId}
                className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:bg-white/10 disabled:opacity-40"
              >
                Añadir al inicio
              </button>
              <button
                type="button"
                onClick={() => void handlePlay(track, 'playnow')}
                disabled={disabled || !canControl || !activeVoiceChannelId}
                className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:bg-white/10 disabled:opacity-40"
              >
                Reemplazar
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
