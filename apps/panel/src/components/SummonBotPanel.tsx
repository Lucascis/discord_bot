'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuildChannel } from '@/lib/channel-client';
import { getGuildChannels } from '@/lib/channel-client';
import { getActiveInstances, summonBot, type ActiveInstance } from '@/lib/player-client';

interface Props {
  guildId?: string;
  panelApiKey: string;
  subscriptionTier?: string;
  disabled?: boolean;
  onSummonSuccess?: (payload: { voiceChannelId: string; textChannelId: string }) => void;
}

export function SummonBotPanel({ guildId, panelApiKey, subscriptionTier, disabled, onSummonSuccess }: Props) {
  const normalizedTier = (subscriptionTier ?? 'FREE').toUpperCase();
  const isPaidPlan = normalizedTier !== 'FREE';
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [voiceChannel, setVoiceChannel] = useState('');
  const [textChannel, setTextChannel] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [activeInstances, setActiveInstances] = useState<ActiveInstance[]>([]);
  const [instanceLimit, setInstanceLimit] = useState<number | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const voiceOptions = useMemo(
    () => channels.filter((channel) => channel.type === 'voice' || channel.type === 'stage'),
    [channels]
  );
  const textOptions = useMemo(
    () => channels.filter((channel) => channel.type === 'text' || channel.type === 'announcement'),
    [channels]
  );

  const activeVoiceIds = useMemo(
    () => new Set(activeInstances.map((instance) => instance.voiceChannelId)),
    [activeInstances]
  );
  const activeTextIds = useMemo(
    () => new Set(activeInstances.map((instance) => instance.textChannelId)),
    [activeInstances]
  );

  const activeInstanceSummaries = useMemo(() => {
    if (activeInstances.length === 0) return [];
    return activeInstances.map((instance) => {
      const voiceName = channels.find((channel) => channel.id === instance.voiceChannelId)?.name ?? instance.voiceChannelId;
      const textName = channels.find((channel) => channel.id === instance.textChannelId)?.name ?? instance.textChannelId;
      return { id: `${instance.voiceChannelId}-${instance.textChannelId}`, label: `${voiceName} → ${textName}` };
    });
  }, [activeInstances, channels]);

  const fetchData = async (isBackground = false) => {
    if (!guildId || !isPaidPlan) return;
    if (!isBackground) setLoadingInstances(true);
    try {
      const [list, instancePayload] = await Promise.all([
        getGuildChannels(guildId, panelApiKey),
        getActiveInstances(guildId, panelApiKey)
      ]);
      const filtered = list.filter((channel) => !channel.name.toLowerCase().includes('channels'));

      setChannels(filtered);
      setActiveInstances(instancePayload.instances ?? []);
      setInstanceLimit(instancePayload.limit ?? null);

      if (!voiceChannel) {
        const defaultVoice = filtered.find((channel) => channel.type === 'voice' || channel.type === 'stage');
        if (defaultVoice) setVoiceChannel(defaultVoice.id);
      }
      if (!textChannel) {
        const defaultText = filtered.find((channel) => channel.type === 'text' || channel.type === 'announcement');
        if (defaultText) setTextChannel(defaultText.id);
      }
    } catch {
      setStatus({ type: 'error', message: 'No pudimos obtener los canales del servidor.' });
    } finally {
      if (!isBackground) setLoadingInstances(false);
    }
  };

  useEffect(() => {
    if (!guildId || !isPaidPlan) {
      setChannels([]);
      setActiveInstances([]);
      setInstanceLimit(null);
      setVoiceChannel('');
      setTextChannel('');
      return;
    }

    let active = true;
    void fetchData();

    const interval = setInterval(() => {
      if (!active) return;
      void fetchData(true);
    }, 15000);
    refreshIntervalRef.current = interval;

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [guildId, isPaidPlan, panelApiKey]);

  useEffect(() => {
    if (voiceChannel && !voiceOptions.some((channel) => channel.id === voiceChannel)) {
      setVoiceChannel(voiceOptions[0]?.id ?? '');
    }
  }, [voiceChannel, voiceOptions]);

  useEffect(() => {
    if (textChannel && !textOptions.some((channel) => channel.id === textChannel)) {
      setTextChannel(textOptions[0]?.id ?? '');
    }
  }, [textChannel, textOptions]);

  if (!guildId || !isPaidPlan) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
        <p>Funcionalidad exclusiva para planes pagos: invocá el bot a un canal de voz y asigná el canal de texto de la UI desde el panel.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!voiceChannel || !textChannel) {
      setStatus({ type: 'error', message: 'Seleccioná canal de voz y texto.' });
      return;
    }

    setLoading(true);
    setStatus(null);
    try {
      await summonBot(guildId, voiceChannel, textChannel, panelApiKey);
      const assigned = { voiceChannelId: voiceChannel, textChannelId: textChannel };
      setStatus({ type: 'success', message: 'Bot invocado. Se moverá si ya estaba activo en otro canal.' });
      onSummonSuccess?.(assigned);
      setActiveInstances((prev) => {
        const filteredPrev = prev.filter(
          (instance) =>
            instance.voiceChannelId !== voiceChannel &&
            instance.textChannelId !== textChannel
        );
        return [...filteredPrev.slice(-4), assigned];
      });
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'No pudimos invocar el bot.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-400/20 bg-gradient-to-br from-brand-500/10 to-black/40 p-4 text-sm text-white/80">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-brand-200">Paid Plan</p>
          <h3 className="text-xl font-semibold text-white">Invocar bot desde el panel</h3>
          <p className="text-white/60">Seleccioná los canales donde querés que el bot aparezca.</p>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-white/40">Plan activo: {normalizedTier}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Canal de voz</span>
          <select
            value={voiceChannel}
            onChange={(event) => setVoiceChannel(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white"
            disabled={loading || disabled || loadingInstances}
          >
            {voiceOptions.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} {activeVoiceIds.has(channel.id) ? '(ocupado)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">Canal de texto</span>
          <select
            value={textChannel}
            onChange={(event) => setTextChannel(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white"
            disabled={loading || disabled || loadingInstances}
          >
            {textOptions.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} {activeTextIds.has(channel.id) ? '(ocupado)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {activeInstanceSummaries.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          <p className="font-semibold">Instancias activas</p>
          <ul className="mt-1 space-y-1">
            {activeInstanceSummaries.map((instance) => (
              <li key={instance.id}>{instance.label}</li>
            ))}
          </ul>
          {instanceLimit !== null && (
            <p className="mt-1 text-amber-200/80">Límite de plan: {instanceLimit} instancia{instanceLimit === 1 ? '' : 's'} en simultáneo.</p>
          )}
        </div>
      )}
      {status && (
        <p className={`mt-3 text-sm ${status.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {status.message}
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={
          loading ||
          disabled ||
          loadingInstances ||
          !voiceChannel ||
          !textChannel
        }
        className="mt-4 inline-flex items-center justify-center rounded-full bg-brand-500 px-6 py-2 font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Invocando...' : 'Invocar bot'}
      </button>
    </div>
  );
}
