import { type VoiceState, type Client } from 'discord.js';
import { logger } from '@discord-bot/logger';

interface NowLiveData {
  channelId: string;
  messageId: string;
  lastUpdate: number;
}

export interface VoiceHandlerContext {
  client: Client;
  nowLive: Map<string, NowLiveData>;
}

export function handleVoiceStateUpdate(
  oldState: VoiceState, 
  newState: VoiceState, 
  context: VoiceHandlerContext
): void {
  try {
    const { client, nowLive } = context;
    const meId = client.user?.id;
    
    if (!meId) return;

    // Only handle events related to the bot itself
    if (newState.member?.user?.id !== meId && oldState.member?.user?.id !== meId) return;

    // Bot disconnection: channelId -> null
    if (oldState.channelId && !newState.channelId) {
      logger.info({ 
        guildId: newState.guild.id, 
        oldChannelId: oldState.channelId,
        action: 'bot-voice-disconnect' 
      }, 'Bot disconnected from voice channel');
      
      // Clear live Now Playing message when bot leaves voice channel
      // This prevents editing stale messages after reconnecting
      nowLive.delete(newState.guild.id);
    }

    // Bot connection: null -> channelId
    if (!oldState.channelId && newState.channelId) {
      logger.info({ 
        guildId: newState.guild.id, 
        newChannelId: newState.channelId,
        action: 'bot-voice-connect' 
      }, 'Bot connected to voice channel');
    }

    // Bot moved between channels
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      logger.info({ 
        guildId: newState.guild.id, 
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
        action: 'bot-voice-move' 
      }, 'Bot moved between voice channels');
    }

  } catch (error) {
    logger.error({ error, guildId: newState.guild.id }, 'Voice state update error');
  }
}

export function setupVoiceHandlers(client: Client, context: VoiceHandlerContext): void {
  client.on('voiceStateUpdate', (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState, context);
  });
  
  logger.info('Voice state handlers registered');
}