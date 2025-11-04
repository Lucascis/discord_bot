import type { Client, TextChannel } from 'discord.js';

export { MusicUIBuilder } from './presentation/ui/music-ui-builder.js';
export type { FilterPanelState } from './presentation/ui/music-ui-builder.js';

/**
 * Resolves a text channel using cache first, then falls back to fetch.
 * Extracted for legacy tests and potential reuse.
 */
export async function resolveTextChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  const cached = client.channels.cache.get(channelId) as TextChannel | undefined;
  if (cached) return cached;

  try {
    return (await client.channels.fetch(channelId)) as TextChannel | null;
  } catch {
    return null;
  }
}
