import { apiFetch } from './api-client';

export type GuildOverview = {
  id: string;
  name: string;
  icon?: string | null;
  available?: boolean;
};

export type GuildSettings = {
  guildId: string;
  defaultVolume: number;
  autoplay: boolean;
  djRoleId?: string;
  maxQueueSize: number;
  allowExplicitContent: boolean;
  defaultSearchSource: 'youtube' | 'spotify' | 'soundcloud';
  announceNowPlaying: boolean;
  deleteInvokeMessage: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGuildSettingsInput = Partial<Pick<GuildSettings,
  'defaultVolume' |
  'autoplay' |
  'djRoleId' |
  'maxQueueSize' |
  'allowExplicitContent' |
  'defaultSearchSource' |
  'announceNowPlaying' |
  'deleteInvokeMessage'
>>;

type GuildPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export async function getGuilds(): Promise<{ data: GuildOverview[]; pagination: GuildPagination }> {
  try {
    return await apiFetch<{ data: GuildOverview[]; pagination: GuildPagination }>('/api/v1/guilds');
  } catch {
    return {
      data: [],
      pagination: { page: 1, limit: 0, total: 0, totalPages: 0, hasNext: false, hasPrevious: false }
    };
  }
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings | null> {
  try {
    return await apiFetch<GuildSettings>(`/api/v1/guilds/${guildId}/settings`);
  } catch {
    return null;
  }
}

export async function updateGuildSettings(guildId: string, input: UpdateGuildSettingsInput): Promise<void> {
  await apiFetch(`/api/v1/guilds/${guildId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}
