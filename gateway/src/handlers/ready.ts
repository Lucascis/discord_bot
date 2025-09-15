import { type Client, type Guild, type Channel, type TextChannel } from 'discord.js';
import { logger } from '@discord-bot/logger';

interface NowLiveData {
  channelId: string;
  messageId: string;
  lastUpdate: number;
}

export interface ReadyHandlerContext {
  client: Client;
  nowLive: Map<string, NowLiveData>;
}

export function handleReady(context: ReadyHandlerContext): void {
  const { client } = context;
  
  if (!client.user) {
    logger.error('Client user is not available on ready');
    return;
  }
  
  logger.info({ 
    tag: client.user.tag,
    id: client.user.id,
    guilds: client.guilds.cache.size
  }, 'Bot logged in successfully');
}

export function handleGuildCreate(guild: Guild): void {
  logger.info({ 
    guildId: guild.id, 
    guildName: guild.name,
    memberCount: guild.memberCount,
    action: 'guild-joined'
  }, 'Bot joined new guild');
}

export function handleGuildDelete(guild: Guild, context: ReadyHandlerContext): void {
  const { nowLive } = context;
  
  logger.info({ 
    guildId: guild.id, 
    guildName: guild.name,
    action: 'guild-left'
  }, 'Bot left guild');
  
  // Clean up live message state when leaving guild
  nowLive.delete(guild.id);
}

export function handleChannelDelete(channel: Channel, context: ReadyHandlerContext): void {
  const { nowLive } = context;
  
  // Clean up live message state when channel is deleted
  const channelId = (channel as unknown as { id?: string } | null)?.id;
  
  if (channelId) {
    logger.info({ 
      channelId, 
      guildId: (channel as TextChannel).guild?.id,
      action: 'channel-deleted'
    }, 'Channel deleted, cleaning up state');
    
    for (const [guildId, live] of nowLive) {
      if (live.channelId === channelId) {
        nowLive.delete(guildId);
        break;
      }
    }
  }
}

export function setupReadyHandlers(client: Client, context: ReadyHandlerContext): void {
  // Bot ready event
  client.once('ready', () => {
    handleReady(context);
  });

  // Guild events
  client.on('guildCreate', (guild) => {
    handleGuildCreate(guild);
  });

  client.on('guildDelete', (guild) => {
    handleGuildDelete(guild, context);
  });

  // Channel events
  client.on('channelDelete', (channel) => {
    handleChannelDelete(channel, context);
  });

  logger.info('Ready and guild handlers registered');
}