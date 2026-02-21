'use client';

import { useState } from 'react';
import { Settings, RotateCcw, Save } from 'lucide-react';
import type { GuildOverview, GuildSettings, UpdateGuildSettingsInput } from '@/lib/guild-client';
import { updateGuildSettings } from '@/lib/guild-client';
import { StudioModeForm } from './StudioModeForm';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'audio', label: 'Audio' },
  { id: 'users', label: 'Users' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'advanced', label: 'Advanced' },
] as const;

interface Props {
  guild: GuildOverview;
  initialSettings: GuildSettings | null;
  currentUserId?: string;
}

export function SettingsView({ guild, initialSettings, currentUserId }: Props) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('general');
  const [settings, setSettings] = useState<GuildSettings | null>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async (payload: UpdateGuildSettingsInput) => {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateGuildSettings(guild.id, payload, '', currentUserId);
      setSettings((prev) => (prev ? { ...prev, ...payload, updatedAt: new Date().toISOString() } : prev));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (initialSettings) setSettings(initialSettings);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
          <Settings className="h-6 w-6 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-white/50 text-sm">Manage your bot configuration and preferences.</p>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-violet-500/20 text-white border border-violet-500/30'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
        {activeTab === 'general' && settings && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Bot Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Bot Status</label>
                  <p className="text-xs text-white/40 mb-2">Set the operational status of the bot.</p>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 w-fit">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-sm text-white">Online</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Command Prefix</label>
                  <input
                    type="text"
                    defaultValue="/"
                    className="w-full max-w-xs px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="!"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Studio Mode & Preferences</h3>
              <StudioModeForm settings={settings} disabled={saving} onSave={handleSave} />
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Audio Settings</h2>
            <p className="text-white/50 text-sm">Configure audio quality, volume normalization, and filters.</p>
            <div className="py-8 text-center text-white/40 text-sm">
              Audio settings coming soon. Use General tab for volume and autoplay.
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Users & Permissions</h2>
            <p className="text-white/50 text-sm">Manage DJ roles and user permissions.</p>
            <div className="py-8 text-center text-white/40 text-sm">User management coming soon.</div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
            <p className="text-white/50 text-sm">Configure alerts and webhooks.</p>
            <div className="py-8 text-center text-white/40 text-sm">Notifications coming soon.</div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Advanced</h2>
            <p className="text-white/50 text-sm">API access, custom branding, and advanced options.</p>
            <div className="py-8 text-center text-white/40 text-sm">Advanced settings coming soon.</div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-white/10">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <button
            onClick={() => settings && handleSave(settings)}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white font-medium transition-colors"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
