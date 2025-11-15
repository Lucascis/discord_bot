'use client';

import { useState, useTransition } from 'react';
import type { GuildOverview, GuildSettings, UpdateGuildSettingsInput } from '@/lib/guild-client';
import { getGuildSettings, updateGuildSettings } from '@/lib/guild-client';
import type { GuildAnalytics } from '@/lib/analytics-client';
import { getGuildAnalytics } from '@/lib/analytics-client';
import { StudioModeForm } from './StudioModeForm';
import { GuildAnalyticsCard } from './GuildAnalyticsCard';

interface Props {
  initialGuilds: GuildOverview[];
  initialSettings: GuildSettings | null;
  initialAnalytics: GuildAnalytics | null;
}

export function GuildDashboard({ initialGuilds, initialSettings, initialAnalytics }: Props) {
  const [selectedGuild, setSelectedGuild] = useState<GuildOverview | null>(initialGuilds[0] ?? null);
  const [settings, setSettings] = useState<GuildSettings | null>(initialSettings);
  const [analytics, setAnalytics] = useState<GuildAnalytics | null>(initialAnalytics);
  const [loading, startTransition] = useTransition();

  const handleSelect = (guild: GuildOverview) => {
    setSelectedGuild(guild);
    startTransition(async () => {
      const [guildSettings, guildAnalytics] = await Promise.all([
        getGuildSettings(guild.id),
        getGuildAnalytics(guild.id)
      ]);
      setSettings(guildSettings);
      setAnalytics(guildAnalytics);
    });
  };

  const handleSave = async (payload: UpdateGuildSettingsInput) => {
    if (!selectedGuild) return;
    await updateGuildSettings(selectedGuild.id, payload);
    setSettings((prev) => (prev ? { ...prev, ...payload, updatedAt: new Date().toISOString() } : prev));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
      <aside className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Guilds</p>
        <ul className="mt-4 space-y-2 text-sm">
          {initialGuilds.map((guild) => (
            <li key={guild.id}>
              <button
                onClick={() => handleSelect(guild)}
                className={`w-full rounded-xl px-4 py-2 text-left ${selectedGuild?.id === guild.id ? 'bg-brand-500/40 text-white' : 'bg-black/30 text-white/70 hover:bg-black/40'}`}
              >
                {guild.name}
              </button>
            </li>
          ))}
          {initialGuilds.length === 0 && <li className="text-white/50">No hay servidores asociados a tu cuenta.</li>}
        </ul>
      </aside>

      <section className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Studio Mode</p>
              <h2 className="text-3xl font-semibold">Personalizá tu bot</h2>
            </div>
            {loading && <span className="text-sm text-white/60">Cargando settings...</span>}
          </div>
          {selectedGuild && settings ? (
            <StudioModeForm
              settings={settings}
              disabled={loading}
              onSave={handleSave}
            />
          ) : (
            <p className="text-white/60">Elegí un guild para editar su configuración.</p>
          )}
        </div>

        <GuildAnalyticsCard analytics={analytics} />
      </section>
    </div>
  );
}
