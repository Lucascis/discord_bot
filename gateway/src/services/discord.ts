import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { setupReadyHandlers, type ReadyHandlerContext } from '../handlers/ready.js';
import { setupVoiceHandlers, type VoiceHandlerContext } from '../handlers/voice.js';

interface NowLiveData {
  channelId: string;
  messageId: string;
  lastUpdate: number;
}

export interface DiscordServiceContext {
  client: Client;
  nowLive: Map<string, NowLiveData>;
}

export function createDiscordClient(): Client {
  return new Client({ 
    intents: [
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildVoiceStates
    ] 
  });
}

export function hasDjOrAdmin(
  interaction: import('discord.js').ButtonInteraction | import('discord.js').ChatInputCommandInteraction,
): boolean {
  type ApiMember = { roles?: string[]; permissions?: { has?: (p: bigint) => boolean } };
  const gm = interaction.member as import('discord.js').GuildMember | ApiMember | null;
  const djRole = interaction.guild?.roles.cache.find((r) => r.name.toLowerCase() === env.DJ_ROLE_NAME.toLowerCase());
  const isAdmin = !!(gm && 'permissions' in gm && (gm as ApiMember).permissions?.has?.(PermissionsBitField.Flags.Administrator));
  
  if (!djRole) return isAdmin;
  
  if (gm && 'roles' in gm && Array.isArray((gm as ApiMember).roles)) {
    return isAdmin || ((gm as ApiMember).roles as string[]).includes(djRole.id);
  }
  
  const fullMember = gm as import('discord.js').GuildMember;
  return isAdmin || fullMember?.roles?.cache?.has(djRole.id);
}

export function setupDiscordHandlers(
  client: Client, 
  nowLive: Map<string, NowLiveData>
): void {
  const readyContext: ReadyHandlerContext = {
    client,
    nowLive,
  };

  const voiceContext: VoiceHandlerContext = {
    client,
    nowLive,
  };

  setupReadyHandlers(client, readyContext);
  setupVoiceHandlers(client, voiceContext);
  
  logger.info('Discord event handlers registered');
}

export async function connectDiscord(
  client: Client,
  nowLive: Map<string, NowLiveData>
): Promise<void> {
  setupDiscordHandlers(client, nowLive);
  
  try {
    await client.login(env.DISCORD_TOKEN);
    logger.info('Discord client logged in successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to login to Discord');
    throw error;
  }
}