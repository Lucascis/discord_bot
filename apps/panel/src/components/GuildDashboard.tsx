'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { GuildOverview, GuildSettings, UpdateGuildSettingsInput } from '@/lib/guild-client';
import { getGuildSettings, updateGuildSettings } from '@/lib/guild-client';
import type { GuildAnalytics } from '@/lib/analytics-client';
import { getGuildAnalytics } from '@/lib/analytics-client';
import type { NowPlayingState, PlayerActionPayload } from '@/lib/player-client';
import { getNowPlaying, sendPlayerCommand, subscribeToPlayerEvents } from '@/lib/player-client';
import { StudioModeForm } from './StudioModeForm';
import { GuildAnalyticsCard } from './GuildAnalyticsCard';
import { WebPlayer } from './WebPlayer';
import { SummonBotPanel } from './SummonBotPanel';
import { TrackSearch } from './TrackSearch';
import { Sidebar } from './Sidebar';

interface Props {
  initialGuilds: GuildOverview[];
  initialSettings: GuildSettings | null;
  initialAnalytics: GuildAnalytics | null;
  initialNowPlaying: NowPlayingState | null;
  initialSelectedGuildId?: string;
  panelApiKey: string;
  currentUserId?: string;
}

export function GuildDashboard({
  initialGuilds,
  initialSettings,
  initialAnalytics,
  initialNowPlaying,
  initialSelectedGuildId,
  panelApiKey,
  currentUserId
}: Props) {
  const router = useRouter();
  const getTierExperience = (tier?: string) => {
    const normalized = (tier ?? 'FREE').toUpperCase();
    if (normalized === 'ENTERPRISE') {
      return {
        label: 'Enterprise Command Center',
        accent: 'from-cyan-500/30 to-brand-500/20',
        bullets: ['Control multi-instancia', 'Automatización de operaciones', 'Prioridad absoluta de soporte']
      };
    }
    if (normalized === 'PREMIUM') {
      return {
        label: 'Premium Performance Profile',
        accent: 'from-brand-500/30 to-fuchsia-500/20',
        bullets: ['Invocación por panel', 'Playback extendido', 'Controles avanzados en tiempo real']
      };
    }
    if (normalized === 'BASIC') {
      return {
        label: 'Basic Plus Profile',
        accent: 'from-brand-500/25 to-amber-400/20',
        bullets: ['Invocación por panel', 'Una instancia activa', 'Control rápido de playlist']
      };
    }
    return {
      label: 'Free Profile',
      accent: 'from-white/10 to-white/5',
      bullets: ['Comandos base habilitados', 'Upgrade para invocar desde panel', 'Upgrade para controles avanzados']
    };
  };

  const guilds = Array.isArray(initialGuilds) ? initialGuilds : [];
  const [selectedGuild, setSelectedGuild] = useState<GuildOverview | null>(
    () => guilds.find((guild) => guild.id === initialSelectedGuildId) ?? guilds[0] ?? null
  );
  const [settings, setSettings] = useState<GuildSettings | null>(initialSettings);
  const [analytics, setAnalytics] = useState<GuildAnalytics | null>(initialAnalytics);
  const [loading, startTransition] = useTransition();
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState | null>(initialNowPlaying);
  const [playerRefreshing, setPlayerRefreshing] = useState(false);
  const [headerIconFailed, setHeaderIconFailed] = useState(false);
  const [channelContext, setChannelContext] = useState<{
    voiceChannelId?: string;
    textChannelId?: string;
  }>({
    voiceChannelId: initialNowPlaying?.voiceChannelId,
    textChannelId: initialNowPlaying?.textChannelId
  });

  const handleSelect = (guild: GuildOverview) => {
    if (selectedGuild?.id === guild.id) return;
    setSelectedGuild(guild);
    router.replace(`/dashboard?guild=${guild.id}`, { scroll: false });
    startTransition(async () => {
      const [guildSettings, guildAnalytics] = await Promise.all([
        getGuildSettings(guild.id, panelApiKey, currentUserId),
        getGuildAnalytics(guild.id, 'week', panelApiKey)
      ]);
      setSettings(guildSettings);
      setAnalytics(guildAnalytics);
    });
  };

  const handleSave = async (payload: UpdateGuildSettingsInput) => {
    if (!selectedGuild) return;
    await updateGuildSettings(selectedGuild.id, payload, panelApiKey, currentUserId);
    setSettings((prev) => (prev ? { ...prev, ...payload, updatedAt: new Date().toISOString() } : prev));
  };

  useEffect(() => {
    if (!selectedGuild) {
      setNowPlaying(null);
      return;
    }

    let active = true;
    const guildId = selectedGuild.id;
    setPlayerRefreshing(true);
    getNowPlaying(guildId, panelApiKey)
      .then((snapshot) => {
        if (active) {
          setNowPlaying(snapshot);
        }
      })
      .catch((error) => {
        console.warn('Failed to fetch now playing state', error);
      })
      .finally(() => {
        if (active) {
          setPlayerRefreshing(false);
        }
      });

    const unsubscribe = subscribeToPlayerEvents(guildId, (payload) => {
      if (active) {
        setNowPlaying(payload);
      }
    }, panelApiKey);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedGuild?.id, panelApiKey]);

  useEffect(() => {
    if (!nowPlaying) return;
    setChannelContext((prev) => ({
      voiceChannelId: nowPlaying.voiceChannelId ?? prev.voiceChannelId,
      textChannelId: nowPlaying.textChannelId ?? prev.textChannelId
    }));
  }, [nowPlaying?.voiceChannelId, nowPlaying?.textChannelId]);

  useEffect(() => {
    setHeaderIconFailed(false);
  }, [selectedGuild?.id, selectedGuild?.icon]);

  const handlePlayerAction = useCallback(async (payload: PlayerActionPayload) => {
    if (!selectedGuild) {
      throw new Error('Select a server to control music.');
    }

    try {
      await sendPlayerCommand(selectedGuild.id, payload, panelApiKey);
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to execute command');
    }
  }, [selectedGuild, panelApiKey]);

  const tierExperience = getTierExperience(selectedGuild?.subscriptionTier);

  return (
    <div className="flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-140px)]">
      <Sidebar
        guilds={guilds}
        selectedGuildId={selectedGuild?.id}
        onSelect={handleSelect}
      />

      <main className="flex-1 min-w-0 space-y-8">
        <AnimatePresence mode="wait">
          {selectedGuild ? (
            <motion.div
              key={selectedGuild.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    {selectedGuild.icon && !headerIconFailed ? (
                      <img
                        src={selectedGuild.icon}
                        alt={selectedGuild.name}
                        className="h-full w-full object-cover"
                        onError={() => setHeaderIconFailed(true)}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white/70">
                        {selectedGuild.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold font-display text-white">{selectedGuild.name}</h1>
                    <p className="text-white/50 text-sm mt-1">Dashboard & Controls</p>
                  </div>
                </div>
                {loading && (
                  <div className="flex items-center gap-2 text-brand-300 text-sm font-medium animate-pulse">
                    <div className="h-2 w-2 rounded-full bg-brand-300" />
                    Syncing...
                  </div>
                )}
              </div>

              <div className="grid gap-8 xl:grid-cols-[1fr,350px]">
                <div className="space-y-8">
                  <WebPlayer
                    guildId={selectedGuild.id}
                    state={nowPlaying}
                    onAction={handlePlayerAction}
                    refreshing={playerRefreshing}
                    panelApiKey={panelApiKey}
                  />

                  <div className="glass-card rounded-2xl p-6">
                    <TrackSearch
                      guildId={selectedGuild.id}
                      panelApiKey={panelApiKey}
                      userId={currentUserId}
                      activeVoiceChannelId={channelContext.voiceChannelId}
                      activeTextChannelId={channelContext.textChannelId}
                      defaultSearchSource={settings?.defaultSearchSource}
                      disabled={loading}
                    />
                  </div>

                  <div className="glass-card rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Studio Mode</p>
                        <h2 className="text-2xl font-semibold mt-1">Customization</h2>
                      </div>
                    </div>
                    {settings ? (
                      <StudioModeForm
                        settings={settings}
                        disabled={loading}
                        onSave={handleSave}
                      />
                    ) : (
                      <div className="h-40 flex items-center justify-center text-white/30">
                        Loading settings...
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-8">
                  <SummonBotPanel
                    guildId={selectedGuild.id}
                    panelApiKey={panelApiKey}
                    subscriptionTier={selectedGuild.subscriptionTier}
                    disabled={loading}
                    onSummonSuccess={(channels) => setChannelContext(channels)}
                  />

                  <div className={`rounded-2xl border border-white/10 bg-gradient-to-br ${tierExperience.accent} p-4`}>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">Profile View</p>
                    <h3 className="mt-2 text-lg font-semibold text-white">{tierExperience.label}</h3>
                    <ul className="mt-3 space-y-1 text-sm text-white/75">
                      {tierExperience.bullets.map((bullet) => (
                        <li key={bullet}>• {bullet}</li>
                      ))}
                    </ul>
                  </div>

                  <GuildAnalyticsCard analytics={analytics} />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4"
            >
              <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white/80">Select a Server</h2>
              <p className="text-white/50 max-w-md">
                Choose a server from the sidebar to manage music, customize settings, and view analytics.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
