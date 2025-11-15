'use client';

import { useState } from 'react';
import type { GuildSettings, UpdateGuildSettingsInput } from '@/lib/guild-client';

interface Props {
  settings: GuildSettings;
  disabled?: boolean;
  onSave: (payload: UpdateGuildSettingsInput) => Promise<void>;
}

export function StudioModeForm({ settings, disabled, onSave }: Props) {
  const [formState, setFormState] = useState<UpdateGuildSettingsInput>({
    defaultVolume: settings.defaultVolume,
    autoplay: settings.autoplay,
    maxQueueSize: settings.maxQueueSize,
    allowExplicitContent: settings.allowExplicitContent,
    defaultSearchSource: settings.defaultSearchSource,
    announceNowPlaying: settings.announceNowPlaying,
    deleteInvokeMessage: settings.deleteInvokeMessage
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleChange = (field: keyof UpdateGuildSettingsInput, value: string | number | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setMessage('Guardando cambios...');
    try {
      await onSave(formState);
      setStatus('success');
      setMessage('Configuración guardada');
    } catch (error) {
      console.error(error);
      setStatus('error');
      setMessage('No pudimos guardar los cambios');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-live="polite">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Volumen por defecto</span>
          <input
            type="number"
            min={0}
            max={100}
            value={formState.defaultVolume ?? 50}
            onChange={(e) => handleChange('defaultVolume', Number(e.target.value))}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2"
            disabled={disabled}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Tamaño máximo de cola</span>
          <input
            type="number"
            min={10}
            max={5000}
            value={formState.maxQueueSize ?? 100}
            onChange={(e) => handleChange('maxQueueSize', Number(e.target.value))}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2"
            disabled={disabled}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            type="checkbox"
            checked={formState.autoplay ?? false}
            onChange={(e) => handleChange('autoplay', e.target.checked)}
            disabled={disabled}
          />
          <span className="text-sm">Autoplay habilitado</span>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            type="checkbox"
            checked={formState.allowExplicitContent ?? true}
            onChange={(e) => handleChange('allowExplicitContent', e.target.checked)}
            disabled={disabled}
          />
          <span className="text-sm">Permitir contenido explícito</span>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            type="checkbox"
            checked={formState.announceNowPlaying ?? true}
            onChange={(e) => handleChange('announceNowPlaying', e.target.checked)}
            disabled={disabled}
          />
          <span className="text-sm">Anunciar "Now Playing"</span>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            type="checkbox"
            checked={formState.deleteInvokeMessage ?? false}
            onChange={(e) => handleChange('deleteInvokeMessage', e.target.checked)}
            disabled={disabled}
          />
          <span className="text-sm">Borrar comando invocado</span>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-white/70">Fuente por defecto</span>
        <select
          className="rounded-xl border border-white/10 bg-black/40 px-3 py-2"
          value={formState.defaultSearchSource}
          onChange={(e) => handleChange('defaultSearchSource', e.target.value as 'youtube' | 'spotify' | 'soundcloud')}
          disabled={disabled}
        >
          <option value="youtube">YouTube</option>
          <option value="spotify">Spotify</option>
          <option value="soundcloud">SoundCloud</option>
        </select>
      </label>

      <button
        type="submit"
        disabled={disabled || status === 'saving'}
        className="w-full rounded-xl bg-brand-500/80 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
      >
        {status === 'saving' ? 'Guardando...' : 'Guardar cambios'}
      </button>
      {message && (
        <p className={`text-sm ${status === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{message}</p>
      )}
    </form>
  );
}
