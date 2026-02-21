'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GuildOverview, GuildSettings } from '@/lib/guild-client';
import type { NowPlayingState, PlayerActionPayload } from '@/lib/player-client';
import { getNowPlaying, sendPlayerCommand, subscribeToPlayerEvents } from '@/lib/player-client';
import { WebPlayer } from './WebPlayer';

interface Props {
  guild: GuildOverview;
  initialNowPlaying: NowPlayingState | null;
  initialSettings: GuildSettings | null;
  panelApiKey: string;
  currentUserId?: string;
}

export function PlayerView({
  guild,
  initialNowPlaying,
  initialSettings,
  panelApiKey,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState | null>(initialNowPlaying);
  const [refreshing, setRefreshing] = useState(false);
  const optimisticGuardRef = useRef<{
    until: number;
    expectedPaused?: boolean;
    expectPositionReset?: boolean;
  } | null>(null);

  const applyOptimisticAction = useCallback((current: NowPlayingState | null, payload: PlayerActionPayload): NowPlayingState | null => {
    if (!current) return current;

    const base = {
      ...current,
      updatedAt: Date.now(),
    };

    switch (payload.action) {
      case 'toggle':
        return { ...base, paused: !current.paused };
      case 'previous':
        return { ...base, positionMs: 0, paused: false };
      case 'skip':
        return { ...base, positionMs: 0, paused: false };
      case 'stop':
        return { ...base, paused: true, positionMs: 0 };
      case 'clear':
        return { ...base, queueLen: 0 };
      case 'shuffle':
        return base;
      case 'mute':
        return { ...base, volume: current.volume === 0 ? 100 : 0 };
      case 'volume':
        return { ...base, volume: payload.value };
      default:
        return base;
    }
  }, []);

  const refreshNowPlayingFast = useCallback(() => {
    void getNowPlaying(guild.id, panelApiKey).then((snapshot) => {
      setNowPlaying(snapshot);
    }).catch(() => {
      // SSE will continue as source of truth if this quick refresh fails.
    });
  }, [guild.id, panelApiKey]);

  const applyOptimisticGuard = useCallback((incoming: NowPlayingState | null): NowPlayingState | null => {
    const guard = optimisticGuardRef.current;
    if (!guard || !incoming) return incoming;

    if (Date.now() > guard.until) {
      optimisticGuardRef.current = null;
      return incoming;
    }

    if (guard.expectedPaused !== undefined && incoming.paused !== guard.expectedPaused) {
      return {
        ...incoming,
        paused: guard.expectedPaused,
        updatedAt: Date.now(),
      };
    }

    if (guard.expectPositionReset && incoming.positionMs > 1200) {
      return {
        ...incoming,
        positionMs: 0,
        updatedAt: Date.now(),
      };
    }

    optimisticGuardRef.current = null;
    return incoming;
  }, []);

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    getNowPlaying(guild.id, panelApiKey)
      .then((s) => active && setNowPlaying(applyOptimisticGuard(s)))
      .finally(() => active && setRefreshing(false));
    const unsub = subscribeToPlayerEvents(
      guild.id,
      (p) => active && setNowPlaying(applyOptimisticGuard(p)),
      panelApiKey
    );
    return () => {
      active = false;
      unsub();
    };
  }, [applyOptimisticGuard, guild.id, panelApiKey]);

  const handleAction = useCallback(
    async (payload: PlayerActionPayload) => {
      const previousState = nowPlaying;
      setNowPlaying((current) => applyOptimisticAction(current, payload));
      if (payload.action === 'toggle') {
        optimisticGuardRef.current = {
          until: Date.now() + 1200,
          expectedPaused: !(nowPlaying?.paused ?? false),
        };
      } else if (payload.action === 'previous') {
        optimisticGuardRef.current = {
          until: Date.now() + 1200,
          expectPositionReset: true,
        };
      } else {
        optimisticGuardRef.current = null;
      }
      try {
        await sendPlayerCommand(guild.id, payload, panelApiKey);
      } catch (error) {
        setNowPlaying(previousState);
        optimisticGuardRef.current = null;
        throw error;
      }

      // Reduce perceived delay waiting for next SSE tick.
      if (payload.action !== 'toggle') {
        refreshNowPlayingFast();
      }
    },
    [applyOptimisticAction, guild.id, nowPlaying, panelApiKey, refreshNowPlayingFast]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Player</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Playing in {guild.name} • Control playback
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
        <WebPlayer
          guildId={guild.id}
          state={nowPlaying}
          onAction={handleAction}
          refreshing={refreshing}
          panelApiKey={panelApiKey}
        />
      </div>
    </div>
  );
}
