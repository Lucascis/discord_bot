import { Client, Guild, GuildMember, VoiceChannel } from 'discord.js';
import { PermissionService } from '../../application/use-cases/play-music-use-case.js';

/**
 * Discord Permission Service Implementation
 * Handles Discord-specific permission and voice channel checks
 */
export class DiscordPermissionService implements PermissionService {
  constructor(private readonly discordClient: Client) {}

  async hasPermissionToControlMusic(
    userId: string,
    guildId: string,
    userRoles: string[],
    djRoleName: string | null
  ): Promise<boolean> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return false;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return false;
      }

      // Check if user has administrator permission
      if (member.permissions.has('Administrator')) {
        return true;
      }

      // Check if user has manage guild permission
      if (member.permissions.has('ManageGuild')) {
        return true;
      }

      // Check DJ role if specified
      if (djRoleName) {
        const hasRole = member.roles.cache.some(role =>
          role.name.toLowerCase() === djRoleName.toLowerCase()
        );
        return hasRole;
      }

      // Default: anyone can control music if no DJ role is set
      return true;

    } catch (error) {
      // On error, default to false for security
      return false;
    }
  }

  async isUserInVoiceChannel(userId: string, guildId: string): Promise<boolean> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return false;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return false;
      }

      return member.voice.channel !== null;

    } catch (error) {
      return false;
    }
  }

  async isUserAloneInVoiceChannel(userId: string, guildId: string): Promise<boolean> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return false;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || !member.voice.channel) {
        return false;
      }

      const voiceChannel = member.voice.channel;

      // Count human members (exclude bots)
      const humanMembers = voiceChannel.members.filter(m => !m.user.bot);

      return humanMembers.size === 1;

    } catch (error) {
      return false;
    }
  }

  async getUserVoiceChannelId(userId: string, guildId: string): Promise<string | null> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return null;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || !member.voice.channel) {
        return null;
      }

      return member.voice.channel.id;

    } catch (error) {
      return null;
    }
  }

  async getVoiceChannelMemberCount(guildId: string, voiceChannelId: string): Promise<number> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return 0;
      }

      const channel = guild.channels.cache.get(voiceChannelId);
      if (!channel || !channel.isVoiceBased()) {
        return 0;
      }

      // Count human members only
      return channel.members.filter(m => !m.user.bot).size;

    } catch (error) {
      return 0;
    }
  }

  async canBotJoinVoiceChannel(guildId: string, voiceChannelId: string): Promise<{
    canJoin: boolean;
    reason?: string;
  }> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return { canJoin: false, reason: 'Guild not found' };
      }

      const channel = guild.channels.cache.get(voiceChannelId);
      if (!channel || !channel.isVoiceBased()) {
        return { canJoin: false, reason: 'Voice channel not found' };
      }

      const botMember = guild.members.me;
      if (!botMember) {
        return { canJoin: false, reason: 'Bot member not found' };
      }

      // Check if bot has permission to connect
      const permissions = channel.permissionsFor(botMember);
      if (!permissions?.has('Connect')) {
        return { canJoin: false, reason: 'Missing Connect permission' };
      }

      // Check if bot has permission to speak
      if (!permissions.has('Speak')) {
        return { canJoin: false, reason: 'Missing Speak permission' };
      }

      // Check if channel is full (if user limit is set)
      if (channel.userLimit > 0 && channel.members.size >= channel.userLimit) {
        // Bot can still join if it has manage channels permission
        if (!permissions.has('ManageChannels')) {
          return { canJoin: false, reason: 'Voice channel is full' };
        }
      }

      return { canJoin: true };

    } catch (error) {
      return {
        canJoin: false,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getUserRoles(userId: string, guildId: string): Promise<string[]> {
    try {
      const guild = this.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        return [];
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return [];
      }

      return member.roles.cache.map(role => role.name);

    } catch (error) {
      return [];
    }
  }
}