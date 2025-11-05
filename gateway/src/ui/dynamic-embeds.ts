/**
 * Dynamic Discord Embeds System
 * Live updating embeds with premium UI features
 */

import { EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  TextChannel,
  User } from 'discord.js';
import { logger } from '@discord-bot/logger';

export interface NowPlayingData {
  track: {
    title: string;
    artist: string;
    duration: number;
    position: number;
    url: string;
    thumbnail?: string;
    requestedBy: User;
  };
  queue: {
    length: number;
    totalDuration: number;
    upcoming: Array<{
      title: string;
      artist: string;
      duration: number;
    }>;
  };
  player: {
    playing: boolean;
    paused: boolean;
    volume: number;
    repeat: 'off' | 'track' | 'queue';
    shuffle: boolean;
    autoplay: boolean;
  };
  effects: {
    crossfade: boolean;
    equalizer: boolean;
    nightcore: boolean;
    bassBoost: number;
  };
  listeners: number;
}

export interface EmbedTheme {
  primaryColor: number;
  accentColor: number;
  errorColor: number;
  successColor: number;
  icons: {
    playing: string;
    paused: string;
    stopped: string;
    repeat: string;
    shuffle: string;
    autoplay: string;
    effects: string;
  };
}

export class DynamicEmbedsSystem {
  private activeEmbeds = new Map<string, Message>();
  private updateIntervals = new Map<string, NodeJS.Timeout>();
  private embedThemes = new Map<string, EmbedTheme>();

  constructor() {
    this.setupDefaultThemes();
  }

  /**
   * Create or update now playing embed with live updates
   */
  async createNowPlayingEmbed(
    channel: TextChannel,
    guildId: string,
    data: NowPlayingData
  ): Promise<Message | null> {
    try {
      // Clear existing embed and interval
      await this.clearNowPlayingEmbed(guildId);

      const embed = this.buildNowPlayingEmbed(guildId, data);
      const buttons = this.buildControlButtons(data.player);

      const message = await channel.send({
        embeds: [embed],
        components: [buttons]
      });

      // Store for updates
      this.activeEmbeds.set(guildId, message);

      // Setup live updates
      this.startLiveUpdates(guildId, data);

      logger.info({ guildId, messageId: message.id }, 'Now playing embed created');
      return message;

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to create now playing embed');
      return null;
    }
  }

  /**
   * Update existing now playing embed
   */
  async updateNowPlayingEmbed(guildId: string, data: NowPlayingData): Promise<void> {
    const message = this.activeEmbeds.get(guildId);
    if (!message) return;

    try {
      const embed = this.buildNowPlayingEmbed(guildId, data);
      const buttons = this.buildControlButtons(data.player);

      await message.edit({
        embeds: [embed],
        components: [buttons]
      });

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to update now playing embed');

      // Message might be deleted, clean up
      this.clearNowPlayingEmbed(guildId);
    }
  }

  /**
   * Build beautiful now playing embed
   */
  private buildNowPlayingEmbed(guildId: string, data: NowPlayingData): EmbedBuilder {
    const theme = this.getTheme(guildId);
    const { track, queue, player, effects, listeners } = data;

    // Calculate progress
    const progress = track.position / track.duration;
    const progressBar = this.createProgressBar(progress, 20);

    // Format duration
    const currentTime = this.formatDuration(track.position);
    const totalTime = this.formatDuration(track.duration);

    // Player status icon
    const statusIcon = player.playing ? theme.icons.playing :
                      player.paused ? theme.icons.paused : theme.icons.stopped;

    const embed = new EmbedBuilder()
      .setColor(theme.primaryColor)
      .setTitle(`${statusIcon} Now Playing`)
      .setDescription(
        `**[${track.title}](${track.url})**\n` +
        `by **${track.artist}**\n\n` +
        `${progressBar}\n` +
        `\`${currentTime}\` ━━━━━━━━━━━━━━━━━━━━ \`${totalTime}\``
      );

    // Add thumbnail if available
    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    // Queue information
    if (queue.length > 0) {
      const upcomingTracks = queue.upcoming.slice(0, 3).map((t, i) =>
        `**${i + 1}.** ${t.title} - *${t.artist}* \`(${this.formatDuration(t.duration)})\``
      ).join('\n');

      embed.addFields({
        name: `📋 Queue (${queue.length} tracks)`,
        value: upcomingTracks + (queue.length > 3 ? `\n*...and ${queue.length - 3} more*` : ''),
        inline: false
      });
    }

    // Player settings
    const settings = [];
    if (player.repeat !== 'off') {
      settings.push(`${theme.icons.repeat} ${player.repeat.toUpperCase()}`);
    }
    if (player.shuffle) {
      settings.push(`${theme.icons.shuffle} SHUFFLE`);
    }
    if (player.autoplay) {
      settings.push(`${theme.icons.autoplay} AUTOPLAY`);
    }

    // Effects status
    const activeEffects = [];
    if (effects.crossfade) activeEffects.push('Crossfade');
    if (effects.equalizer) activeEffects.push('Equalizer');
    if (effects.nightcore) activeEffects.push('Nightcore');
    if (effects.bassBoost > 0) activeEffects.push(`Bass +${Math.round(effects.bassBoost * 100)}%`);

    if (activeEffects.length > 0) {
      settings.push(`${theme.icons.effects} ${activeEffects.join(', ')}`);
    }

    if (settings.length > 0) {
      embed.addFields({
        name: '⚙️ Settings',
        value: settings.join(' • '),
        inline: true
      });
    }

    // Footer with additional info
    embed.setFooter({
      text: `👥 ${listeners} listening • Volume: ${player.volume}% • Requested by ${track.requestedBy.displayName}`,
      iconURL: track.requestedBy.displayAvatarURL({ size: 32 })
    });

    embed.setTimestamp();

    return embed;
  }

  /**
   * Build interactive control buttons
   */
  private buildControlButtons(playerState: NowPlayingData['player']): ActionRowBuilder<ButtonBuilder> {
    const row1 = new ActionRowBuilder<ButtonBuilder>();

    // Play/Pause button
    const playPauseButton = new ButtonBuilder()
      .setCustomId('player_playpause')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(playerState.playing ? '⏸️' : '▶️');

    // Skip backward button
    const backwardButton = new ButtonBuilder()
      .setCustomId('player_backward')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏪');

    // Skip forward button
    const forwardButton = new ButtonBuilder()
      .setCustomId('player_forward')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏩');

    // Skip button
    const skipButton = new ButtonBuilder()
      .setCustomId('player_skip')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏭️');

    row1.addComponents(playPauseButton, backwardButton, forwardButton, skipButton);

    return row1;
  }

  /**
   * Create volume and effects control buttons (second row)
   */
  private buildSecondaryControls(playerState: NowPlayingData['player']): ActionRowBuilder<ButtonBuilder> {
    const row2 = new ActionRowBuilder<ButtonBuilder>();

    // Volume down
    const volumeDownButton = new ButtonBuilder()
      .setCustomId('player_volume_down')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔉');

    // Volume up
    const volumeUpButton = new ButtonBuilder()
      .setCustomId('player_volume_up')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔊');

    // Repeat button
    const repeatButton = new ButtonBuilder()
      .setCustomId('player_repeat')
      .setStyle(playerState.repeat !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('🔁');

    // Stop button
    const stopButton = new ButtonBuilder()
      .setCustomId('player_stop')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️');

    row2.addComponents(volumeDownButton, volumeUpButton, repeatButton, stopButton);

    return row2;
  }

  /**
   * Create third row with queue and effects controls
   */
  private buildTertiaryControls(playerState: NowPlayingData['player']): ActionRowBuilder<ButtonBuilder> {
    const row3 = new ActionRowBuilder<ButtonBuilder>();

    // Shuffle button
    const shuffleButton = new ButtonBuilder()
      .setCustomId('player_shuffle')
      .setStyle(playerState.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('🔀');

    // Queue button
    const queueButton = new ButtonBuilder()
      .setCustomId('player_queue')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🗒️');

    // Clear queue button
    const clearButton = new ButtonBuilder()
      .setCustomId('player_clear')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🧹');

    // Autoplay button
    const autoplayButton = new ButtonBuilder()
      .setCustomId('player_autoplay')
      .setStyle(playerState.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('▶️');

    row3.addComponents(shuffleButton, queueButton, clearButton, autoplayButton);

    return row3;
  }

  /**
   * Setup live progress updates
   */
  private startLiveUpdates(guildId: string, initialData: NowPlayingData): void {
    // Clear existing interval
    const existingInterval = this.updateIntervals.get(guildId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Update every 5 seconds for smooth progress
    const interval = setInterval(async () => {
      // This would get real-time data from the audio service
      const currentData = await this.getCurrentPlaybackData(guildId);
      if (currentData) {
        await this.updateNowPlayingEmbed(guildId, currentData);
      }
    }, 5000);

    this.updateIntervals.set(guildId, interval);
  }

  /**
   * Create visual progress bar
   */
  private createProgressBar(progress: number, length: number = 20): string {
    const filled = Math.round(progress * length);
    const empty = length - filled;

    const fillChar = '━';
    const emptyChar = '─';
    const pointer = '🔘';

    if (filled === 0) {
      return pointer + emptyChar.repeat(length - 1);
    } else if (filled === length) {
      return fillChar.repeat(length - 1) + pointer;
    } else {
      return fillChar.repeat(filled - 1) + pointer + emptyChar.repeat(empty);
    }
  }

  /**
   * Format duration in MM:SS format
   */
  private formatDuration(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Create queue embed for detailed queue view
   */
  async createQueueEmbed(
    channel: TextChannel,
    guildId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queueData: any,
    page: number = 0
  ): Promise<Message | null> {
    try {
      const theme = this.getTheme(guildId);
      const itemsPerPage = 10;
      const startIndex = page * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;

      const queueSlice = queueData.tracks.slice(startIndex, endIndex);
      const totalPages = Math.ceil(queueData.tracks.length / itemsPerPage);

      const embed = new EmbedBuilder()
        .setColor(theme.primaryColor)
        .setTitle('🗒️ Music Queue')
        .setDescription(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          queueSlice.map((track: any, index: number) => {
            const position = startIndex + index + 1;
            const duration = this.formatDuration(track.duration);
            const isNext = position === 1 ? '▶️ ' : '';
            return `${isNext}**${position}.** ${track.title} - *${track.artist}* \`(${duration})\``;
          }).join('\n') || 'Queue is empty'
        );

      if (queueData.tracks.length > 0) {
        embed.addFields({
          name: '📊 Queue Info',
          value:
            `**Total Tracks:** ${queueData.tracks.length}\n` +
            `**Total Duration:** ${this.formatDuration(queueData.totalDuration)}\n` +
            `**Current Page:** ${page + 1}/${totalPages}`,
          inline: true
        });
      }

      embed.setFooter({
        text: `Page ${page + 1} of ${totalPages}`,
      });

      embed.setTimestamp();

      // Add navigation buttons if multiple pages
      const components = [];
      if (totalPages > 1) {
        const navRow = new ActionRowBuilder<ButtonBuilder>();

        navRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`queue_prev_${page}`)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('◀️')
            .setDisabled(page === 0),

          new ButtonBuilder()
            .setCustomId(`queue_next_${page}`)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('▶️')
            .setDisabled(page === totalPages - 1)
        );

        components.push(navRow);
      }

      return await channel.send({
        embeds: [embed],
        components
      });

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to create queue embed');
      return null;
    }
  }

  /**
   * Create effects control embed
   */
  async createEffectsEmbed(
    channel: TextChannel,
    guildId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    effectsData: any
  ): Promise<Message | null> {
    try {
      const theme = this.getTheme(guildId);

      const embed = new EmbedBuilder()
        .setColor(theme.accentColor)
        .setTitle('🎛️ Audio Effects')
        .setDescription('Configure premium audio effects for enhanced listening experience');

      // Equalizer section
      embed.addFields({
        name: '🎚️ Equalizer',
        value: `Status: ${effectsData.equalizer.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
               `Preset: ${effectsData.equalizer.preset || 'Custom'}`,
        inline: true
      });

      // Creative effects
      embed.addFields({
        name: '🎭 Creative Effects',
        value:
          `Nightcore: ${effectsData.nightcore.enabled ? '✅' : '❌'}\n` +
          `Daycore: ${effectsData.daycore.enabled ? '✅' : '❌'}\n` +
          `8D Audio: ${effectsData.eightD.enabled ? '✅' : '❌'}`,
        inline: true
      });

      // Audio enhancement
      embed.addFields({
        name: '🔊 Enhancement',
        value:
          `Bass Boost: ${Math.round(effectsData.bassBoost * 100)}%\n` +
          `Crossfade: ${effectsData.crossfade.enabled ? '✅' : '❌'}\n` +
          `Normalization: ${effectsData.loudnessNormalization ? '✅' : '❌'}`,
        inline: true
      });

      // Effects control buttons
      const controlRow = new ActionRowBuilder<ButtonBuilder>();

      controlRow.addComponents(
        new ButtonBuilder()
          .setCustomId('effects_equalizer')
          .setLabel('Equalizer')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎚️'),

        new ButtonBuilder()
          .setCustomId('effects_creative')
          .setLabel('Creative')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎭'),

        new ButtonBuilder()
          .setCustomId('effects_enhancement')
          .setLabel('Enhancement')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔊'),

        new ButtonBuilder()
          .setCustomId('effects_reset')
          .setLabel('Reset All')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔄')
      );

      return await channel.send({
        embeds: [embed],
        components: [controlRow]
      });

    } catch (error) {
      logger.error({ error, guildId }, 'Failed to create effects embed');
      return null;
    }
  }

  /**
   * Clear now playing embed and stop updates
   */
  async clearNowPlayingEmbed(guildId: string): Promise<void> {
    // Clear update interval
    const interval = this.updateIntervals.get(guildId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(guildId);
    }

    // Delete message if it exists
    const message = this.activeEmbeds.get(guildId);
    if (message) {
      try {
        await message.delete();
      } catch (error) {
        // Message might already be deleted
        logger.debug({ error, guildId }, 'Could not delete embed message');
      }

      this.activeEmbeds.delete(guildId);
    }

    logger.info({ guildId }, 'Now playing embed cleared');
  }

  /**
   * Set custom theme for guild
   */
  setGuildTheme(guildId: string, theme: Partial<EmbedTheme>): void {
    const currentTheme = this.getTheme(guildId);
    const newTheme = { ...currentTheme, ...theme };
    this.embedThemes.set(guildId, newTheme);

    logger.info({ guildId }, 'Guild theme updated');
  }

  /**
   * Get theme for guild (or default)
   */
  private getTheme(guildId: string): EmbedTheme {
    return this.embedThemes.get(guildId) || this.getDefaultTheme();
  }

  /**
   * Setup default themes
   */
  private setupDefaultThemes(): void {
    // Default theme will be used if no custom theme is set
    logger.info('Dynamic embeds system initialized');
  }

  private getDefaultTheme(): EmbedTheme {
    return {
      primaryColor: 0x1f8b4c, // Green
      accentColor: 0x3498db,  // Blue
      errorColor: 0xe74c3c,   // Red
      successColor: 0x2ecc71, // Green
      icons: {
        playing: '▶️',
        paused: '⏸️',
        stopped: '⏹️',
        repeat: '🔁',
        shuffle: '🔀',
        autoplay: '🎵',
        effects: '🎛️'
      }
    };
  }

  /**
   * Mock function - would integrate with audio service
   */
  private async getCurrentPlaybackData(guildId: string): Promise<NowPlayingData | null> {
    // This would integrate with the actual audio service to get real-time data
    return null;
  }
}