import type { LavalinkManager, Player } from 'lavalink-client';

export function createAndConnectPlayer(
  manager: LavalinkManager,
  opts: { guildId: string; voiceChannelId: string; textChannelId?: string; volume?: number }
): Promise<Player> {
  const options = {
    guildId: opts.guildId,
    voiceChannelId: opts.voiceChannelId,
    ...(opts.textChannelId ? { textChannelId: opts.textChannelId } : {}),
    selfDeaf: true,
    volume: opts.volume ?? 100,
  };
  const player = manager.createPlayer(options);
  return player.connect().then(() => player);
}
