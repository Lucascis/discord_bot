'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NowPlayingState, PlayerActionPayload, QueueSnapshot } from '@/lib/player-client';
import { buildStreamUrl, getQueueSnapshot, requestStreamToken } from '@/lib/player-client';
import { getLyrics, type LyricsPayload } from '@/lib/lyrics-client';

interface Props {
  guildId?: string;
  state: NowPlayingState | null;
  onAction: (payload: PlayerActionPayload) => Promise<void>;
  refreshing?: boolean;
  panelApiKey: string;
}

export function WebPlayer({ guildId, state, onAction, refreshing = false, panelApiKey }: Props) {
  const [volume, setVolume] = useState(state?.volume ?? 100);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentActionRef = useRef<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [panelPlayback, setPanelPlayback] = useState(false);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelStatus, setPanelStatus] = useState<'idle' | 'buffering' | 'playing' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tick, setTick] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsPayload | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queuePage, setQueuePage] = useState(1);
  const [selectedFilterPreset, setSelectedFilterPreset] = useState('flat');

  useEffect(() => {
    setVolume(state?.volume ?? 100);
  }, [state?.volume]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (panelPlayback && (!state?.streamable || !guildId)) {
      stopPanelPlayback();
    }
  }, [panelPlayback, state?.streamable, guildId]);

  useEffect(() => () => stopPanelPlayback(), []);

  useEffect(() => {
    setArtworkFailed(false);
  }, [state?.artworkUrl, state?.title]);

  useEffect(() => {
    if (!guildId) {
      setQueueSnapshot(null);
      return;
    }
    let active = true;
    const loadQueue = async () => {
      try {
        setQueueLoading(true);
        const snapshot = await getQueueSnapshot(guildId, { page: queuePage }, panelApiKey);
        if (active) {
          setQueueSnapshot(snapshot);
        }
      } catch {
        if (active) {
          setQueueSnapshot(null);
        }
      } finally {
        if (active) {
          setQueueLoading(false);
        }
      }
    };
    void loadQueue();
    const interval = setInterval(() => {
      void loadQueue();
    }, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [guildId, panelApiKey, queuePage, state?.title, state?.positionMs, state?.queueLen, state?.paused]);

  useEffect(() => {
    const interval = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!showLyrics) return;
    if (!state?.title) {
      setLyrics(null);
      setLyricsError(null);
      return;
    }

    let active = true;
    setLyricsLoading(true);
    setLyricsError(null);
    void getLyrics({
      title: state.title,
      artist: state.author,
      durationMs: state.durationMs
    }).then((payload) => {
      if (!active) return;
      setLyrics(payload);
      if (!payload || payload.lines.length === 0) {
        setLyricsError('No encontramos letra sincronizada para este track.');
      }
    }).catch(() => {
      if (!active) return;
      setLyrics(null);
      setLyricsError('Falló la carga de letras en este momento.');
    }).finally(() => {
      if (active) {
        setLyricsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [showLyrics, state?.title, state?.author, state?.durationMs]);

  const handleAction = (payload: PlayerActionPayload) => {
    if (!state) return;
    const actionKey = payload.action;
    const now = Date.now();
    const lastAttempt = recentActionRef.current.get(actionKey) ?? 0;
    if (now - lastAttempt < 180) return;
    recentActionRef.current.set(actionKey, now);

    setPendingActions((prev) => {
      const next = new Set(prev);
      next.add(actionKey);
      return next;
    });

    // Keep browser-side audio in sync for immediate perceived response.
    if (payload.action === 'toggle' && panelPlayback && audioRef.current) {
      if (state.paused) {
        void audioRef.current.play().catch(() => {
          // UI command still proceeds even if browser autoplay blocks.
        });
      } else {
        audioRef.current.pause();
      }
    }

    setError(null);
    void onAction(payload)
      .catch((actionError) => {
        setError(actionError instanceof Error ? actionError.message : 'No se pudo ejecutar la acción');
      })
      .finally(() => {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(actionKey);
          return next;
        });
      });
  };

  const ensureAudioElement = () => {
    if (!audioRef.current) {
      const element = document.createElement('audio');
      element.crossOrigin = 'anonymous';
      element.preload = 'none';
      element.controls = false;
      audioRef.current = element;
    }
    return audioRef.current;
  };

  const startPanelPlayback = async () => {
    if (!guildId || !state?.streamable) return;
    setPanelLoading(true);
    setPanelStatus('buffering');
    setPanelError(null);
    try {
      const { token } = await requestStreamToken(guildId, panelApiKey);
      const element = ensureAudioElement();
      element.src = buildStreamUrl(guildId, token, panelApiKey);
      element.loop = false;
      await element.play();
      setPanelPlayback(true);
      setPanelStatus('playing');
    } catch (playError) {
      console.error(playError);
      setPanelError('No pudimos reproducir audio en el navegador. Intentá nuevamente.');
      stopPanelPlayback();
      setPanelStatus('error');
    } finally {
      setPanelLoading(false);
    }
  };

  function stopPanelPlayback() {
    setPanelPlayback(false);
    setPanelStatus('idle');
    const element = audioRef.current;
    if (element) {
      element.pause();
      element.src = '';
    }
  }

  const handleVolumeChange = (next: number) => {
    setVolume(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void handleAction({ action: 'volume', value: next });
    }, 400);
  };

  const livePositionMs = useMemo(() => {
    if (!state) return 0;
    if (state.paused || !state.updatedAt) {
      return state.positionMs ?? 0;
    }
    const delta = Date.now() - state.updatedAt;
    return Math.min(state.durationMs ?? 0, (state.positionMs ?? 0) + delta);
  }, [state, tick]);

  const progress = useMemo(() => {
    if (!state?.durationMs || state.durationMs === 0) return 0;
    return Math.min(100, Math.max(0, (livePositionMs / state.durationMs) * 100));
  }, [state?.durationMs, livePositionMs]);

  const activeLyricIndex = useMemo(() => {
    if (!lyrics || lyrics.lines.length === 0) return -1;

    if (lyrics.synced) {
      let activeIndex = -1;
      for (let index = 0; index < lyrics.lines.length; index += 1) {
        const lineTime = lyrics.lines[index]?.timeMs;
        if (typeof lineTime === 'number' && lineTime <= livePositionMs) {
          activeIndex = index;
        } else if (typeof lineTime === 'number' && lineTime > livePositionMs) {
          break;
        }
      }
      return Math.max(0, activeIndex);
    }

    if (!state?.durationMs || state.durationMs <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, livePositionMs / state.durationMs));
    return Math.min(lyrics.lines.length - 1, Math.floor(ratio * lyrics.lines.length));
  }, [lyrics, livePositionMs, state?.durationMs]);

  const lyricContext = useMemo(() => {
    if (!lyrics || lyrics.lines.length === 0 || activeLyricIndex < 0) {
      return {
        previous: '',
        current: '',
        next: ''
      };
    }

    return {
      previous: lyrics.lines[activeLyricIndex - 1]?.text ?? '',
      current: lyrics.lines[activeLyricIndex]?.text ?? '',
      next: lyrics.lines[activeLyricIndex + 1]?.text ?? ''
    };
  }, [lyrics, activeLyricIndex]);

  useEffect(() => {
    const element = ensureAudioElement();
    const handlePlaying = () => setPanelStatus('playing');
    const handleWaiting = () => setPanelStatus('buffering');
    const handleEnded = () => {
      setPanelStatus('idle');
      setPanelPlayback(false);
    };
    const handleError = () => {
      setPanelStatus('error');
      setPanelError('El reproductor del panel tuvo un problema. Reintentá.');
      setPanelPlayback(false);
    };
    element.addEventListener('playing', handlePlaying);
    element.addEventListener('waiting', handleWaiting);
    element.addEventListener('ended', handleEnded);
    element.addEventListener('error', handleError);
    return () => {
      element.removeEventListener('playing', handlePlaying);
      element.removeEventListener('waiting', handleWaiting);
      element.removeEventListener('ended', handleEnded);
      element.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (panelPlayback && state?.streamable && guildId) {
      void startPanelPlayback();
      return;
    }
    if (!state?.streamable && panelPlayback) {
      stopPanelPlayback();
    }
  }, [panelPlayback, state?.uri, state?.streamable, guildId]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-3xl p-8 relative overflow-hidden"
    >
      {/* Background Glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-brand-500/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent-cyan/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

      <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Main Player Area */}
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-300">Now Playing</p>
              <h2 className="text-3xl font-display font-bold mt-1 gradient-text">
                {state?.title ?? 'Ready to Play'}
              </h2>
              <p className="text-lg text-white/60 font-medium">{state?.author ?? 'Queue is empty'}</p>
              {refreshing && (
                <p className="text-xs text-brand-200/80 mt-2 animate-pulse">Refreshing player state...</p>
              )}
            </div>
            {state?.streamable && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => (panelPlayback ? stopPanelPlayback() : startPanelPlayback())}
                disabled={panelLoading}
                className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${panelPlayback
                  ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/50 shadow-neon-cyan'
                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
                  }`}
              >
                {panelPlayback ? 'Web Audio Active' : panelLoading ? 'Connecting...' : 'Enable Web Audio'}
              </motion.button>
            )}
          </div>

          <div className="flex gap-8">
            {/* Artwork */}
            <motion.div
              layoutId="artwork"
              className="relative w-48 h-48 rounded-2xl overflow-hidden shadow-2xl border border-white/10 group"
            >
              {state?.artworkUrl && !artworkFailed ? (
                <>
                  <img
                    src={state.artworkUrl}
                    alt={state.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    onError={() => setArtworkFailed(true)}
                  />
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                </>
              ) : (
                <div className="w-full h-full bg-surface flex items-center justify-center">
                  <span className="text-4xl text-white/20">♪</span>
                </div>
              )}
              {/* Lyrics Toggle Overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                <button
                  onClick={() => setShowLyrics(!showLyrics)}
                  className="px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 text-white text-sm font-medium backdrop-blur-md border border-white/20 transition-all"
                >
                  {showLyrics ? 'Hide Lyrics' : 'Show Lyrics'}
                </button>
              </div>
            </motion.div>

            {/* Controls & Progress */}
            <div className="flex-1 flex flex-col justify-end space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-white/40">
                  <span>{formatTimestamp(livePositionMs)}</span>
                  <span>{formatTimestamp(state?.durationMs ?? 0)}</span>
                </div>
                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-brand-400 to-accent-cyan rounded-full shadow-neon-brand"
                    style={{ width: `${progress}%` }}
                    layoutId="progress"
                  />
                </div>
              </div>

              {/* Main Controls */}
              <div className="flex items-center gap-4">
                <ControlBtn label="Previous track" icon="⏮" onClick={() => handleAction({ action: 'previous' })} disabled={!state || pendingActions.has('previous')} />
                <ControlBtn
                  label={state?.paused ? 'Resume playback' : 'Pause playback'}
                  icon={state?.paused ? "▶" : "⏸"}
                  onClick={() => handleAction({ action: 'toggle' })}
                  primary
                  disabled={!state || pendingActions.has('toggle')}
                />
                <ControlBtn label="Skip track" icon="⏭" onClick={() => handleAction({ action: 'skip' })} disabled={!state || pendingActions.has('skip')} />
                <div className="w-px h-8 bg-white/10 mx-2" />
                <ControlBtn label="Stop playback" icon="⏹" onClick={() => handleAction({ action: 'stop' })} disabled={!state || pendingActions.has('stop')} />
                <ControlBtn label="Shuffle queue" icon="🔀" onClick={() => handleAction({ action: 'shuffle' })} disabled={!state || pendingActions.has('shuffle')} />
              </div>
            </div>
          </div>
        </div>

        {/* Side Panel (Volume & Settings) */}
        <div className="w-full lg:w-72 glass-card rounded-2xl p-6 space-y-6">
          {/* Volume */}
          <div className="space-y-3">
            <div className="flex justify-between text-xs font-medium text-white/60">
              <span>Volume</span>
              <span>{volume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
              disabled={!state}
            />
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => handleAction({ action: 'mute' })} disabled={!state || pendingActions.has('mute')}>
              {state?.volume === 0 ? 'Unmute' : 'Mute'}
            </ActionButton>
            <ActionButton onClick={() => handleAction({ action: 'clear' })} disabled={!state || pendingActions.has('clear')}>
              Clear Queue
            </ActionButton>
            <ActionButton onClick={() => handleAction({ action: 'autoplay' })} disabled={!state || pendingActions.has('autoplay')}>
              Autoplay Mode
            </ActionButton>
            <ActionButton
              onClick={() => handleAction({ action: 'filter', preset: selectedFilterPreset })}
              disabled={!state || pendingActions.has('filter')}
            >
              Apply Filter
            </ActionButton>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-white/50 uppercase tracking-[0.24em]">Filter preset</p>
            <select
              value={selectedFilterPreset}
              onChange={(event) => setSelectedFilterPreset(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="flat">Flat</option>
              <option value="bassboost">Bass Boost</option>
              <option value="nightcore">Nightcore</option>
              <option value="vaporwave">Vaporwave</option>
              <option value="karaoke">Karaoke</option>
            </select>
          </div>

          {/* Status Tags */}
          <div className="space-y-2 pt-4 border-t border-white/5">
            <StatusTag label="Autoplay" value={state?.autoplayMode ?? 'off'} />
            <StatusTag label="Repeat" value={state?.repeatMode ?? 'off'} />
            <StatusTag label="Web audio" value={panelStatus} />
            {state?.source && (
              <StatusTag label="Fuente" value={state.source} />
            )}
            {state?.source && (
              <StatusTag label="Calidad efectiva" value={getEffectiveSourceQuality(state.source)} />
            )}
            {state?.filter && <StatusTag label="Filter" value={state.filter.label} />}
            {state?.source && (
              <p className="text-[11px] text-white/55">{getLosslessTransparencyNote(state.source)}</p>
            )}
            {panelError && (
              <p className="text-xs text-rose-300/80">{panelError}</p>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-8 grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.24em] text-white/40">Queue</p>
            <p className="text-xs text-white/55">
              {queueLoading ? 'Syncing…' : `${queueSnapshot?.totalTracks ?? 0} tracks`}
            </p>
          </div>
          <div className="space-y-2">
            {(queueSnapshot?.items ?? []).length === 0 && (
              <p className="text-sm text-white/50">No hay tracks en cola.</p>
            )}
            {(queueSnapshot?.items ?? []).map((item, index) => (
              <div key={`${item.uri ?? item.title}-${index}`} className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-sm text-white">{item.title}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setQueuePage((prev) => Math.max(1, prev - 1))}
              disabled={queuePage <= 1}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 disabled:opacity-40"
            >
              Prev
            </button>
            <p className="text-xs text-white/55">Page {queueSnapshot?.page ?? queuePage} / {Math.max(queueSnapshot?.totalPages ?? 1, 1)}</p>
            <button
              type="button"
              onClick={() =>
                setQueuePage((prev) => {
                  const maxPages = Math.max(queueSnapshot?.totalPages ?? 1, 1);
                  return Math.min(maxPages, prev + 1);
                })
              }
              disabled={queuePage >= Math.max(queueSnapshot?.totalPages ?? 1, 1)}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-white/40">History</p>
          <div className="mt-3 space-y-2">
            {queueSnapshot?.current && (
              <div className="rounded-lg border border-brand-400/30 bg-brand-500/10 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-brand-100/80">Current</p>
                <p className="text-sm text-white">{queueSnapshot.current.title}</p>
              </div>
            )}
            {(queueSnapshot?.history ?? []).length === 0 && (
              <p className="text-sm text-white/50">Sin historial reciente.</p>
            )}
            {(queueSnapshot?.history ?? []).map((item, index) => (
              <div key={`${item.uri ?? item.title}-${index}`} className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-sm text-white/80">{item.title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lyrics / Visualizer Overlay */}
      <AnimatePresence>
        {showLyrics && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 pt-6 border-t border-white/5"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-white/40 text-sm uppercase tracking-widest">Lyrics Live</p>
                {lyrics?.source && (
                  <p className="text-[11px] uppercase tracking-[0.24em] text-white/30">Source: {lyrics.source}</p>
                )}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-5 min-h-[190px] flex flex-col justify-center text-center">
                  {lyricsLoading && (
                    <p className="text-sm text-white/60">Cargando letras…</p>
                  )}
                  {!lyricsLoading && lyricContext.current && (
                    <div className="space-y-4">
                      {lyricContext.previous && (
                        <p className="text-white/35 text-lg">{lyricContext.previous}</p>
                      )}
                      <motion.p
                        key={`${activeLyricIndex}-${lyricContext.current}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-2xl text-white font-display font-semibold leading-relaxed gradient-text"
                      >
                        {lyricContext.current}
                      </motion.p>
                      {lyricContext.next && (
                        <p className="text-white/40 text-lg">{lyricContext.next}</p>
                      )}
                    </div>
                  )}
                  {!lyricsLoading && !lyricContext.current && (
                    <p className="text-sm text-white/50">{lyricsError ?? 'No hay letras disponibles para este track.'}</p>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 min-h-[190px]">
                  <p className="text-xs uppercase tracking-[0.24em] text-white/40 mb-3">Lyrics Timeline</p>
                  <div className="max-h-[220px] overflow-y-auto space-y-1 pr-2">
                    {(lyrics?.lines ?? []).map((line, index) => {
                      const isActive = index === activeLyricIndex;
                      return (
                        <p
                          key={`${index}-${line.timeMs ?? index}`}
                          className={isActive
                            ? 'text-brand-100 text-base font-semibold'
                            : 'text-white/55 text-sm'}
                        >
                          {line.text}
                        </p>
                      );
                    })}
                    {!lyricsLoading && (!lyrics || lyrics.lines.length === 0) && (
                      <p className="text-sm text-white/50">{lyricsError ?? 'No hay letras disponibles para este track.'}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-6 left-6 right-6 bg-rose-500/10 border border-rose-500/20 text-rose-200 px-4 py-3 rounded-xl backdrop-blur-md text-sm font-medium text-center"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={audioRef} className="hidden" />
    </motion.section>
  );
}

function ControlBtn({ icon, label, onClick, primary, disabled }: { icon: string; label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`
        flex items-center justify-center rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed
        ${primary
          ? 'w-14 h-14 bg-brand-500 text-white shadow-neon-brand hover:bg-brand-400 text-xl'
          : 'w-10 h-10 bg-white/5 text-white/80 hover:bg-white/10 border border-white/5 text-lg'}
      `}
    >
      {icon}
    </motion.button>
  );
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={typeof children === 'string' ? children : undefined}
      className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-medium text-white/70 transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function StatusTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-white/40">{label}</span>
      <span className="px-2 py-0.5 rounded-md bg-white/5 text-brand-200 font-medium border border-white/5 capitalize">
        {value}
      </span>
    </div>
  );
}

function formatTimestamp(value: number): string {
  if (!value || value <= 0) return '0:00';
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getEffectiveSourceQuality(source: string): 'standard' | 'high' | 'lossless' {
  const normalized = source.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'local') return 'lossless';
  if (normalized === 'youtube' || normalized === 'youtube_music' || normalized === 'spotify' || normalized === 'soundcloud' || normalized === 'bandcamp' || normalized === 'vimeo') {
    return 'high';
  }
  return 'standard';
}

function getLosslessTransparencyNote(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'local') {
    return 'Lossless disponible solo si el origen real es FLAC/ALAC/PCM.';
  }
  if (normalized === 'youtube' || normalized === 'youtube_music' || normalized === 'spotify') {
    return 'Esta fuente no entrega lossless real en este flujo.';
  }
  return 'Calidad final depende del códec y bitrate de la fuente.';
}
