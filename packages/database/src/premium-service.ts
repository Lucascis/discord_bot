import { PrismaClient } from '@prisma/client';
import {
  SubscriptionTier,
  getFeatureGatesForTier,
  FeatureGates,
  PluginSource,
  PLUGIN_SOURCE_MAPPING
} from '@discord-bot/config';

export class PremiumService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get or create server configuration with default values
   */
  async getServerConfig(guildId: string) {
    let config = await this.prisma.serverConfiguration.findUnique({
      where: { guildId },
      include: { channels: true },
    });

    if (!config) {
      config = await this.prisma.serverConfiguration.create({
        data: { guildId },
        include: { channels: true },
      });
    }

    return config;
  }

  /**
   * Get effective configuration for a specific channel (with inheritance from server)
   */
  async getChannelConfig(guildId: string, channelId: string) {
    const serverConfig = await this.getServerConfig(guildId);

    const channelConfig = await this.prisma.channelConfiguration.findUnique({
      where: {
        guildId_channelId: { guildId, channelId }
      },
    });

    // Merge server and channel configs (channel overrides server)
    return {
      guildId,
      channelId,
      musicEnabled: channelConfig?.musicEnabled ?? true,
      playlistsEnabled: channelConfig?.playlistsEnabled ?? true,
      spotifyEnabled: channelConfig?.spotifyEnabled ?? serverConfig.spotifyEnabled,
      appleMusicEnabled: channelConfig?.appleMusicEnabled ?? serverConfig.appleMusicEnabled,
      deezerEnabled: channelConfig?.deezerEnabled ?? serverConfig.deezerEnabled,
      lyricsEnabled: channelConfig?.lyricsEnabled ?? serverConfig.lyricsEnabled,
      sponsorBlockEnabled: channelConfig?.sponsorBlockEnabled ?? serverConfig.sponsorBlockEnabled,
      volumeLimit: channelConfig?.volumeLimit ?? serverConfig.volumeLimit,
      maxQueueSize: channelConfig?.maxQueueSize ?? serverConfig.maxQueueSize,
      maxSongDuration: channelConfig?.maxSongDuration ?? serverConfig.maxSongDuration,
      djOnlyMode: channelConfig?.djOnlyMode ?? serverConfig.djOnlyMode,
      allowExplicitContent: channelConfig?.allowExplicitContent ?? serverConfig.allowExplicitContent,
      subscriptionTier: serverConfig.subscriptionTier as SubscriptionTier,
      djRoleId: serverConfig.djRoleId,
      voteSkipEnabled: serverConfig.voteSkipEnabled,
      voteSkipThreshold: serverConfig.voteSkipThreshold,
    };
  }

  /**
   * Update server configuration
   */
  async updateServerConfig(guildId: string, updates: Partial<{
    subscriptionTier: string;
    spotifyEnabled: boolean;
    appleMusicEnabled: boolean;
    deezerEnabled: boolean;
    lyricsEnabled: boolean;
    sponsorBlockEnabled: boolean;
    maxAudioQuality: string;
    volumeLimit: number;
    maxQueueSize: number;
    maxSongDuration: number;
    allowExplicitContent: boolean;
    djRoleId: string | null;
    djOnlyMode: boolean;
    voteSkipEnabled: boolean;
    voteSkipThreshold: number;
  }>) {
    return this.prisma.serverConfiguration.upsert({
      where: { guildId },
      create: { guildId, ...updates },
      update: updates,
    });
  }

  /**
   * Update channel-specific configuration
   */
  async updateChannelConfig(guildId: string, channelId: string, updates: Partial<{
    musicEnabled: boolean;
    playlistsEnabled: boolean;
    spotifyEnabled: boolean | null;
    appleMusicEnabled: boolean | null;
    deezerEnabled: boolean | null;
    lyricsEnabled: boolean | null;
    sponsorBlockEnabled: boolean | null;
    volumeLimit: number | null;
    maxQueueSize: number | null;
    maxSongDuration: number | null;
    djOnlyMode: boolean | null;
    allowExplicitContent: boolean | null;
  }>) {
    return this.prisma.channelConfiguration.upsert({
      where: {
        guildId_channelId: { guildId, channelId }
      },
      create: { guildId, channelId, ...updates },
      update: updates,
    });
  }

  /**
   * Get feature gates for a specific server/channel
   */
  async getFeatureGates(guildId: string, channelId?: string): Promise<FeatureGates & {
    canUseChannel: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    effectiveConfig: any;
  }> {
    const config = channelId
      ? await this.getChannelConfig(guildId, channelId)
      : await this.getServerConfig(guildId);

    const tier = config.subscriptionTier as SubscriptionTier;
    const baseGates = getFeatureGatesForTier(tier);

    // Apply server/channel specific overrides
    const effectiveConfig = channelId ? config : config;

    return {
      ...baseGates,
      // Override with actual config values
      canUseSpotify: effectiveConfig.spotifyEnabled && baseGates.canUseSpotify,
      canUseAppleMusic: effectiveConfig.appleMusicEnabled && baseGates.canUseAppleMusic,
      canUseDeezer: effectiveConfig.deezerEnabled && baseGates.canUseDeezer,
      canUseLyrics: effectiveConfig.lyricsEnabled && baseGates.canUseLyrics,
      canUseSponsorBlock: effectiveConfig.sponsorBlockEnabled && baseGates.canUseSponsorBlock,
      maxVolumeLimit: Math.min(effectiveConfig.volumeLimit, baseGates.maxVolumeLimit),
      maxQueueSize: Math.min(effectiveConfig.maxQueueSize, baseGates.maxQueueSize),
      maxSongDurationSeconds: Math.min(effectiveConfig.maxSongDuration, baseGates.maxSongDurationSeconds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canUseChannel: channelId ? (effectiveConfig as any).musicEnabled !== false : true,
      effectiveConfig,
    };
  }

  /**
   * Get user subscription information
   */
  async getUserSubscription(userId: string) {
    return this.prisma.userSubscription.findUnique({
      where: { userId },
    });
  }

  /**
   * Update user subscription
   */
  async updateUserSubscription(userId: string, updates: Partial<{
    tier: string;
    expiresAt: Date | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    paymentMethod: string | null;
    premiumServers: number;
    customBotEnabled: boolean;
    prioritySupport: boolean;
  }>) {
    return this.prisma.userSubscription.upsert({
      where: { userId },
      create: { userId, ...updates },
      update: updates,
    });
  }

  /**
   * Check if user can upgrade a server to premium
   */
  async canUserUpgradeServer(userId: string, guildId: string): Promise<boolean> {
    const userSub = await this.getUserSubscription(userId);
    if (!userSub || userSub.tier === 'free') return false;

    const serverConfig = await this.getServerConfig(guildId);
    if (serverConfig.subscriptionTier !== 'free') return false; // Already upgraded

    // Check if user has premium server slots available
    if (userSub.premiumServers === -1) return true; // Unlimited

    const upgradedServers = await this.prisma.serverConfiguration.count({
      where: {
        subscriptionTier: { not: 'free' },
        // In a real implementation, you'd track which user upgraded which server
      },
    });

    return upgradedServers < userSub.premiumServers;
  }

  /**
   * Cache lyrics for a track
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async cacheLyrics(trackId: string, title: string, artist: string, lyrics: string, source: string, timedLyrics = false, lyricsData?: any) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Cache for 7 days

    return this.prisma.lyricsCache.upsert({
      where: { trackId },
      create: {
        trackId,
        title,
        artist,
        lyrics,
        source,
        timedLyrics,
        lyricsData: lyricsData ? JSON.stringify(lyricsData) : null,
        expiresAt,
      },
      update: {
        lyrics,
        source,
        timedLyrics,
        lyricsData: lyricsData ? JSON.stringify(lyricsData) : null,
        expiresAt,
      },
    });
  }

  /**
   * Get cached lyrics for a track
   */
  async getCachedLyrics(trackId: string) {
    const cached = await this.prisma.lyricsCache.findUnique({
      where: { trackId },
    });

    if (!cached || cached.expiresAt < new Date()) {
      return null;
    }

    return {
      ...cached,
      lyricsData: cached.lyricsData ? JSON.parse(cached.lyricsData) : null,
    };
  }

  /**
   * Record playback history
   */
  async recordPlayback(data: {
    guildId: string;
    userId: string;
    channelId: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
    source: string;
    playedFully?: boolean;
    skipReason?: string;
    playbackQuality?: string;
    pluginsUsed?: string[];
  }) {
    return this.prisma.playbackHistory.create({
      data: {
        ...data,
        pluginsUsed: data.pluginsUsed || [],
      },
    });
  }

  /**
   * Get search prefix for a plugin source
   */
  getSearchPrefix(source: PluginSource, type: 'search' | 'playlist' | 'album' | 'artist' = 'search'): string {
    const mapping = PLUGIN_SOURCE_MAPPING[source];
    if (!mapping) return 'ytsearch:'; // Default fallback

    switch (type) {
      case 'playlist':
        return ('playlistPrefix' in mapping ? mapping.playlistPrefix : null) || mapping.searchPrefix;
      case 'album':
        return ('albumPrefix' in mapping ? mapping.albumPrefix : null) || mapping.searchPrefix;
      case 'artist':
        return ('artistPrefix' in mapping ? mapping.artistPrefix : null) || mapping.searchPrefix;
      default:
        return mapping.searchPrefix;
    }
  }

  /**
   * Get available search sources for a guild/channel
   */
  async getAvailableSources(guildId: string, channelId?: string): Promise<PluginSource[]> {
    const gates = await this.getFeatureGates(guildId, channelId);
    const sources: PluginSource[] = ['youtube', 'youtubemusicSearch']; // Always available

    if (gates.canUseSpotify) sources.push('spotify');
    if (gates.canUseAppleMusic) sources.push('applemusic');
    if (gates.canUseDeezer) sources.push('deezer');

    return sources;
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache() {
    const now = new Date();

    // Clean up expired lyrics
    await this.prisma.lyricsCache.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Clean up old playback history (keep 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await this.prisma.playbackHistory.deleteMany({
      where: { playedAt: { lt: thirtyDaysAgo } },
    });
  }
}

export default PremiumService;