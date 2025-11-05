import { PrismaClient } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';
import { SettingsCache } from '@discord-bot/cache';

export interface GuildSettings {
  guildId: string;
  ephemeralMessages: boolean;
  djRoleId?: string;
  djOnlyMode: boolean;
  autoplayEnabled: boolean;
  autoplayMode: string;
  maxQueueSize: number;
  volumeLimit: number;
  voteSkipEnabled: boolean;
  voteSkipThreshold: number;
  persistentConnection: boolean;
  subscriptionTier: string;
}

export class SettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settingsCache?: SettingsCache
  ) {}

  async getGuildSettings(guildId: string): Promise<GuildSettings> {
    // Use cache if available, otherwise fall back to direct database query
    if (this.settingsCache) {
      try {
        const cachedSettings = await this.settingsCache.getOrSetGuildSettings(
          guildId,
          () => this.fetchGuildSettingsFromDatabase(guildId),
          600000 // 10 minute TTL for settings cache
        );

        return cachedSettings as GuildSettings;
      } catch (error) {
        logger.error({ error, guildId }, 'Cache error in getGuildSettings, falling back to database');
        // Fall back to direct database query if cache fails
        return this.fetchGuildSettingsFromDatabase(guildId);
      }
    }

    // No cache available, query database directly
    return this.fetchGuildSettingsFromDatabase(guildId);
  }

  private async fetchGuildSettingsFromDatabase(guildId: string): Promise<GuildSettings> {
    try {
      const serverConfig = await this.prisma.serverConfiguration.findUnique({
        where: { guildId }
      });

      if (!serverConfig) {
        // Return defaults for new guilds - will be created on first setting update
        logger.info({ guildId }, 'No server configuration found, returning defaults');
        return this.getDefaultSettings(guildId);
      }

      return {
        guildId: serverConfig.guildId,
        ephemeralMessages: serverConfig.ephemeralMessages,
        djRoleId: serverConfig.djRoleId || undefined,
        djOnlyMode: serverConfig.djOnlyMode,
        autoplayEnabled: serverConfig.autoplayEnabled,
        autoplayMode: serverConfig.autoplayMode,
        maxQueueSize: serverConfig.maxQueueSize,
        volumeLimit: serverConfig.volumeLimit,
        voteSkipEnabled: serverConfig.voteSkipEnabled,
        voteSkipThreshold: serverConfig.voteSkipThreshold,
        persistentConnection: serverConfig.persistentConnection,
        subscriptionTier: serverConfig.subscriptionTier
      };
    } catch (error) {
      logger.error({ error, guildId }, 'Failed to fetch guild settings from database');
      // Return defaults on error to ensure service continues functioning
      return this.getDefaultSettings(guildId);
    }
  }

  async setButtonResponseMessages(guildId: string, enabled: boolean): Promise<void> {
    try {
      await this.prisma.serverConfiguration.upsert({
        where: { guildId },
        update: {
          ephemeralMessages: enabled,
          updatedAt: new Date()
        },
        create: {
          guildId,
          ephemeralMessages: enabled,
          // Include all required defaults for new server configurations
          subscriptionTier: 'free',
          spotifyEnabled: false,
          appleMusicEnabled: false,
          deezerEnabled: false,
          lyricsEnabled: false,
          sponsorBlockEnabled: true,
          advancedSearchEnabled: false,
          maxAudioQuality: 'medium',
          volumeLimit: 200,
          maxQueueSize: 100,
          maxSongDuration: 3600,
          allowExplicitContent: true,
          djOnlyMode: false,
          voteSkipEnabled: true,
          voteSkipThreshold: 0.5,
          autoplayEnabled: false,
          autoplayMode: 'similar',
          autoplayQueueSize: 10
        }
      });

      // Invalidate cache after successful update
      if (this.settingsCache) {
        await this.settingsCache.invalidateGuildSettings(guildId);
      }

      logger.info({ guildId, ephemeralMessages: enabled }, 'Updated ephemeral messages setting');
    } catch (error) {
      logger.error({ error, guildId, enabled }, 'Failed to update ephemeral messages setting');
      throw new Error('Failed to update ephemeral messages setting');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateSetting(guildId: string, setting: string, value: any): Promise<void> {
    try {
      // Validate the setting is allowed to be updated
      const allowedSettings = [
        'ephemeralMessages', 'djRoleId', 'djOnlyMode', 'autoplayEnabled',
        'autoplayMode', 'maxQueueSize', 'volumeLimit', 'voteSkipEnabled',
        'voteSkipThreshold', 'maxAudioQuality', 'allowExplicitContent', 'persistentConnection'
      ];

      if (!allowedSettings.includes(setting)) {
        throw new Error(`Setting '${setting}' is not allowed to be updated`);
      }

      // Premium validation for persistent connection
      if (setting === 'persistentConnection' && value === true) {
        const currentSettings = await this.fetchGuildSettingsFromDatabase(guildId);
        if (currentSettings.subscriptionTier === 'free') {
          throw new Error('Persistent voice connections are only available for premium subscribers. Upgrade your server to enable 24/7 connections.');
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        [setting]: value,
        updatedAt: new Date()
      };

      await this.prisma.serverConfiguration.upsert({
        where: { guildId },
        update: updateData,
        create: {
          guildId,
          ...updateData,
          // Include defaults for required fields when creating new config
          subscriptionTier: 'free',
          spotifyEnabled: false,
          appleMusicEnabled: false,
          deezerEnabled: false,
          lyricsEnabled: false,
          sponsorBlockEnabled: true,
          advancedSearchEnabled: false,
          maxAudioQuality: value === 'maxAudioQuality' ? value : 'medium',
          volumeLimit: setting === 'volumeLimit' ? value : 200,
          maxQueueSize: setting === 'maxQueueSize' ? value : 100,
          maxSongDuration: 3600,
          allowExplicitContent: setting === 'allowExplicitContent' ? value : true,
          djOnlyMode: setting === 'djOnlyMode' ? value : false,
          voteSkipEnabled: setting === 'voteSkipEnabled' ? value : true,
          voteSkipThreshold: setting === 'voteSkipThreshold' ? value : 0.5,
          autoplayEnabled: setting === 'autoplayEnabled' ? value : false,
          autoplayMode: setting === 'autoplayMode' ? value : 'similar',
          autoplayQueueSize: 10,
          ephemeralMessages: setting === 'ephemeralMessages' ? value : false,
          persistentConnection: setting === 'persistentConnection' ? value : false
        }
      });

      // Invalidate cache after successful update
      if (this.settingsCache) {
        await this.settingsCache.invalidateGuildSettings(guildId);
      }

      logger.info({ guildId, setting, value }, 'Updated guild setting');
    } catch (error) {
      logger.error({ error, guildId, setting, value }, `Failed to update ${setting} setting`);
      throw new Error(`Failed to update ${setting} setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async setPersistentConnection(guildId: string, enabled: boolean): Promise<void> {
    try {
      // First, check if guild has premium subscription when enabling persistent connection
      if (enabled) {
        const currentSettings = await this.fetchGuildSettingsFromDatabase(guildId);
        if (currentSettings.subscriptionTier === 'free') {
          throw new Error('Persistent voice connections are only available for premium subscribers. Upgrade your server to enable 24/7 connections.');
        }
      }

      await this.prisma.serverConfiguration.upsert({
        where: { guildId },
        update: {
          persistentConnection: enabled,
          updatedAt: new Date()
        },
        create: {
          guildId,
          persistentConnection: enabled,
          // Include all required defaults for new server configurations
          subscriptionTier: 'free', // Will prevent enabling persistent connection for new free servers
          spotifyEnabled: false,
          appleMusicEnabled: false,
          deezerEnabled: false,
          lyricsEnabled: false,
          sponsorBlockEnabled: true,
          advancedSearchEnabled: false,
          maxAudioQuality: 'medium',
          volumeLimit: 200,
          maxQueueSize: 100,
          maxSongDuration: 3600,
          allowExplicitContent: true,
          djOnlyMode: false,
          voteSkipEnabled: true,
          voteSkipThreshold: 0.5,
          autoplayEnabled: false,
          autoplayMode: 'similar',
          autoplayQueueSize: 10,
          ephemeralMessages: false
        }
      });

      // Invalidate cache after successful update
      if (this.settingsCache) {
        await this.settingsCache.invalidateGuildSettings(guildId);
      }

      logger.info({ guildId, persistentConnection: enabled }, 'Updated persistent connection setting');
    } catch (error) {
      logger.error({ error, guildId, enabled }, 'Failed to update persistent connection setting');
      throw error; // Re-throw to preserve the premium validation error message
    }
  }

  private getDefaultSettings(guildId: string): GuildSettings {
    return {
      guildId,
      ephemeralMessages: false, // Default to false per Discord 5-Rule system (Rule 5: only when setting is ON)
      djOnlyMode: false,
      autoplayEnabled: false,
      autoplayMode: 'similar',
      maxQueueSize: 100,
      volumeLimit: 200,
      voteSkipEnabled: true,
      voteSkipThreshold: 0.5,
      persistentConnection: false, // 24/7 connections require premium
      subscriptionTier: 'free'
    };
  }
}