import { apiFetch } from './api-client';

export type GuildChannel = {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'stage' | 'announcement';
};

export async function getGuildChannels(guildId: string, apiKey?: string): Promise<GuildChannel[]> {
  if (!guildId) return [];
  try {
    const response = await apiFetch<{ data: GuildChannel[] }>(`/api/v1/panel/guilds/${guildId}/channels`, {
      rawResponse: true,
      apiKey
    });
    return response.data;
  } catch {
    return [];
  }
}
