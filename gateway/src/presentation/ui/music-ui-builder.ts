import { EmbedBuilder, User, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';

/**
 * Music UI Builder
 * Pure UI building logic for music-related Discord embeds and components
 */
export class MusicUIBuilder {

  buildPlaySuccessEmbed(data: {
    trackTitle: string;
    queuePosition?: number;
    requestedBy: User;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x6A0DAD) // Dark violet premium theme
      .setFooter({
        text: `Requested by ${data.requestedBy.displayName}`,
        iconURL: data.requestedBy.displayAvatarURL()
      })
      .setTimestamp();

    if (data.queuePosition) {
      embed
        .setTitle('✨ Added to Queue')
        .setDescription(`**${data.trackTitle}**`)
        .addFields({
          name: 'Queue Position',
          value: `${data.queuePosition}`,
          inline: true
        });
    } else {
      embed
        .setTitle('✨ Now Playing')
        .setDescription(`**${data.trackTitle}**`);
    }

    return embed;
  }

  buildAddedToQueueEmbed(data: {
    trackTitle: string;
    artist?: string;
    duration?: number;
    queuePosition: number;
    artworkUrl?: string;
    requestedBy: User;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x6A0DAD) // Dark violet premium theme
      .setTitle('✨ Added to Queue')
      .setTimestamp()
      .setFooter({
        text: `Requested by ${data.requestedBy.displayName}`,
        iconURL: data.requestedBy.displayAvatarURL()
      });

    // Track title and artist with premium styling
    let description = `**${data.trackTitle}**`;
    if (data.artist) {
      description += `\n*by ${data.artist}*`;
    }
    if (data.duration) {
      description += `\n⏱️ Duration: **${this.formatTime(data.duration)}**`;
    }
    embed.setDescription(description);

    // Thumbnail with improved quality
    if (data.artworkUrl) {
      const highQualityUrl = this.improveImageQuality(data.artworkUrl);
      embed.setThumbnail(highQualityUrl);
    }

    // Premium queue position with enhanced styling
    embed.addFields({
      name: '💎 Position in Queue',
      value: `**#${data.queuePosition}**`,
      inline: true
    });

    return embed;
  }

  buildControlSuccessEmbed(
    action: string,
    message: string,
    user: User
  ): EmbedBuilder {
    const icons = {
      'Paused': '⏸️',
      'Resumed': '▶️',
      'Stopped': '⏹️',
      'Volume Changed': '🔊',
      'Loop Mode Changed': '🔁'
    };

    const icon = icons[action as keyof typeof icons] || '🎵';

    return new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`${icon} ${action}`)
      .setDescription(message)
      .setFooter({
        text: `Action by ${user.displayName}`,
        iconURL: user.displayAvatarURL()
      })
      .setTimestamp();
  }

  buildErrorEmbed(
    title: string,
    message: string,
    user?: User
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle(`❌ ${title}`)
      .setDescription(message)
      .setTimestamp();

    if (user) {
      embed.setFooter({
        text: `Error for ${user.displayName}`,
        iconURL: user.displayAvatarURL()
      });
    }

    return embed;
  }

  buildNowPlayingEmbed(data: {
    trackTitle: string;
    artist?: string;
    duration?: number;
    position?: number;
    volume: number;
    loopMode: 'off' | 'track' | 'queue';
    queueLength: number;
    isPaused: boolean;
    artworkUrl?: string;
    autoplayMode?: 'off' | 'similar' | 'artist' | 'genre' | 'mixed';
  }): EmbedBuilder {
    const statusIcon = data.isPaused ? '⏸️' : '✨';
    const statusText = data.isPaused ? 'Paused' : 'Now Playing';
    const color = data.isPaused ? 0xFFAA00 : 0x6A0DAD; // Dark violet premium theme when playing

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${statusIcon} ${statusText}`)
      .setTimestamp();

    // Clean and spaced layout for PC
    // Track info with proper formatting
    let description = `**${data.trackTitle}**`;
    if (data.artist) {
      description += `\n*by ${data.artist}*`;
    }
    embed.setDescription(description);

    // Browser-style image positioning: below title, above progress
    if (data.artworkUrl) {
      const highQualityUrl = this.improveImageQuality(data.artworkUrl);
      embed.setImage(highQualityUrl);
    }

    // Progress bar with clear spacing
    if (data.duration && data.position !== undefined) {
      const progress = this.formatProgressClean(data.position, data.duration);
      embed.addFields({
        name: '⏱️ Progress',
        value: progress,
        inline: false
      });
    }

    // Separate fields for better readability
    // Volume and Loop controls
    const volumeBar = this.createVolumeBar(data.volume);
    const loopStatus = data.loopMode === 'off' ? 'Disabled' : data.loopMode === 'track' ? 'Current Track' : 'Entire Queue';

    embed.addFields(
      {
        name: '🔊 Volume',
        value: `${volumeBar} **${data.volume}%**`,
        inline: true
      },
      {
        name: '🔁 Loop Mode',
        value: `**${loopStatus}**`,
        inline: true
      },
      {
        name: '⚡ Status',
        value: data.isPaused ? '**Paused**' : '**Playing**',
        inline: true
      }
    );

    // Queue and Autoplay with clear separation
    const queueText = data.queueLength > 0 ? `**${data.queueLength} tracks** waiting` : '**Empty** - No tracks queued';

    // Autoplay mode description
    const autoplayMode = data.autoplayMode || 'off';
    const autoplayDescriptions = {
      'off': '**Disabled**',
      'similar': '**Enabled** • *Similar tracks*',
      'artist': '**Enabled** • *Same artist*',
      'genre': '**Enabled** • *Same genre*',
      'mixed': '**Enabled** • *Mixed variety*'
    };
    const autoplayText = autoplayDescriptions[autoplayMode] || '**Disabled**';

    embed.addFields(
      {
        name: '📋 Queue',
        value: queueText,
        inline: true
      },
      {
        name: '▶️ Autoplay',
        value: autoplayText,
        inline: true
      },
      {
        name: '🎛️ Filter',
        value: '**None** • *Coming soon*',
        inline: true
      }
    );

    // Thumbnail now handled as embedded field above for better positioning

    return embed;
  }

  private createVolumeBar(volume: number): string {
    const maxBars = 8;
    // Fix: Calculate bars based on 200% max volume (0-200)
    const filledBars = Math.min(maxBars, Math.max(0, Math.round((volume / 200) * maxBars)));

    // Simplified volume bar for mobile
    const filled = '▓'.repeat(filledBars);
    const empty = '░'.repeat(maxBars - filledBars);

    return filled + empty;
  }

  buildMusicControlButtons(state?: {
    isPlaying?: boolean;
    isPaused?: boolean;
    hasQueue?: boolean;
    queueLength?: number;
    canSkip?: boolean;
    volume?: number;
    loopMode?: 'off' | 'track' | 'queue';
    isMuted?: boolean;
    autoplayMode?: 'off' | 'similar' | 'artist' | 'genre' | 'mixed';
  }): ActionRowBuilder<ButtonBuilder>[] {
    // Extract state information with defaults
    const isPlaying = state?.isPlaying ?? false;
    const isPaused = state?.isPaused ?? false;
    const hasQueue = state?.hasQueue ?? false;
    const queueLength = state?.queueLength ?? 0;
    const autoplayMode = state?.autoplayMode ?? 'off';
    const autoplayEnabled = autoplayMode !== 'off';
    // Can skip if: there's a queue, OR (there's a track playing/paused AND autoplay is on)
    const canSkip = state?.canSkip ?? (hasQueue || queueLength > 0 || ((isPlaying || isPaused) && autoplayEnabled));
    const volume = state?.volume ?? 100;
    const loopMode = state?.loopMode ?? 'off';
    const isMuted = state?.isMuted ?? false;

    // Row 1: NAVEGACIÓN - Previous | -30s | Play/Pause | +30s | Skip
    const row1 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_previous')
          .setLabel('⏮️ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_seek_back_30')
          .setLabel('⏪ -30seg')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_playpause')
          .setLabel(isPaused ? '▶️ Play  ' : isPlaying ? '⏸️ Pause ' : '⏯️ Toggle')
          .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track is loaded
        new ButtonBuilder()
          .setCustomId('music_seek_forward_30')
          .setLabel('⏩ +30seg')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_skip')
          .setLabel('⏭️ Skip  ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!canSkip) // Disabled if no queue or current track
      );

    // Row 2: AUDIO - Mute | Vol- | Vol+ | Filters | Stop
    const row2 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_mute')
          .setLabel(isMuted ? '🔊 Unmute ' : '🔇 Mute  ')
          .setStyle(isMuted ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_volume_down')
          .setLabel('🔉 Vol-  ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(volume <= 0 || isMuted || (!isPlaying && !isPaused)), // Disabled at min volume, muted, or no track
        new ButtonBuilder()
          .setCustomId('music_volume_up')
          .setLabel('🔊 Vol+  ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(volume >= 200 || isMuted || (!isPlaying && !isPaused)), // Disabled at max volume, muted, or no track
        new ButtonBuilder()
          .setCustomId('music_filters')
          .setLabel('🎚️ Filters')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_stop')
          .setLabel('⏹️ Stop  ')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!isPlaying && !isPaused) // Disabled if no track
      );

    // Row 3: PLAYLIST - Shuffle | Loop | Queue | Clear | Autoplay
    const row3 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_shuffle')
          .setLabel('🔀 Shuffle')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!hasQueue || queueLength < 2), // Disabled if no queue or only 1 item
        new ButtonBuilder()
          .setCustomId('music_loop')
          .setLabel(loopMode === 'off' ? '🔁 Loop  ' : loopMode === 'track' ? '🔂 Track ' : '🔁 Queue ')
          .setStyle(loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(!isPlaying && !isPaused), // Disabled if no track
        new ButtonBuilder()
          .setCustomId('music_queue')
          .setLabel('🗒️ Queue ')
          .setStyle(queueLength > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_clear')
          .setLabel('🧹 Clear ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!hasQueue && !isPlaying && !isPaused), // Disabled if nothing to clear
        new ButtonBuilder()
          .setCustomId('music_autoplay')
          .setLabel(
            autoplayMode === 'off' ? '▶️ Auto  ' :
            autoplayMode === 'similar' ? '🎵 Similar' :
            autoplayMode === 'artist' ? '👤 Artist' :
            autoplayMode === 'genre' ? '🎸 Genre ' :
            '🔀 Mixed '
          )
          .setStyle(autoplayMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(!isPlaying && !isPaused) // Disabled if no track
      );

    return [row1, row2, row3];
  }

  buildQueueEmbed(data: {
    tracks: Array<{
      title: string;
      artist?: string;
      duration?: number;
      requestedBy: string;
    }>;
    currentTrack?: {
      title: string;
      artist?: string;
      position: number;
      duration?: number;
    };
    totalDuration?: number;
    page: number;
    totalPages: number;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🗒️ Upcoming Tracks')
      .setTimestamp();

    if (data.tracks.length === 0) {
      embed.setDescription('No tracks in queue. The current track will end without anything to follow.');

      if (data.currentTrack) {
        embed.addFields({
          name: '🎵 Currently Playing',
          value: `**${data.currentTrack.title}**`,
          inline: false
        });
      }
    } else {
      const queueList = data.tracks
        .map((track, index) => {
          const number = (data.page - 1) * 10 + index + 1;
          const duration = track.duration ? ` (${this.formatTime(track.duration)})` : '';
          return `**${number}.** ${track.title}${duration}`;
        })
        .join('\n');

      embed.setDescription(`**Next up:**\n${queueList}`);

      if (data.totalDuration) {
        embed.addFields({
          name: '⏱️ Queue Duration',
          value: this.formatTime(data.totalDuration),
          inline: true
        });
      }

      if (data.totalPages > 1) {
        embed.setFooter({
          text: `Page ${data.page} of ${data.totalPages}`
        });
      }
    }

    return embed;
  }

  private formatProgress(position: number, duration: number): string {
    const positionStr = this.formatTime(position);
    const durationStr = this.formatTime(duration);
    const percentage = Math.round((position / duration) * 100);

    // Simplified progress bar optimized for mobile
    const barLength = 20;
    const filledLength = Math.round((position / duration) * barLength);

    // Clean and readable progress bar
    const filled = '▓'.repeat(filledLength);
    const empty = '░'.repeat(barLength - filledLength);
    const bar = filled + empty;

    return `\`${positionStr}\` ${bar} \`${durationStr}\`\n**${percentage}%** • ${this.formatTime(duration - position)} left`;
  }

  private formatProgressHorizontal(position: number, duration: number): string {
    const positionStr = this.formatTime(position);
    const durationStr = this.formatTime(duration);
    const percentage = Math.round((position / duration) * 100);

    // Longer progress bar for horizontal layout
    const barLength = 30;
    const filledLength = Math.round((position / duration) * barLength);

    // Clean and readable progress bar
    const filled = '▓'.repeat(filledLength);
    const empty = '░'.repeat(barLength - filledLength);
    const bar = filled + empty;

    return `${bar} ${positionStr} / ${durationStr} (${percentage}% • ${this.formatTime(duration - position)} left)`;
  }

  private formatProgressClean(position: number, duration: number): string {
    const positionStr = this.formatTime(position);
    const durationStr = this.formatTime(duration);
    const percentage = Math.round((position / duration) * 100);

    // Clean progress bar with good spacing
    const barLength = 25;
    const filledLength = Math.round((position / duration) * barLength);

    const filled = '▓'.repeat(filledLength);
    const empty = '░'.repeat(barLength - filledLength);
    const bar = filled + empty;

    return `**${positionStr}** ${bar} **${durationStr}**\n**${percentage}%** complete\n*${this.formatTime(duration - position)} remaining*`;
  }

  private formatTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const sec = seconds % 60;
    const min = minutes % 60;

    if (hours > 0) {
      return `${hours}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    } else {
      return `${min}:${sec.toString().padStart(2, '0')}`;
    }
  }

  private formatLoopMode(mode: 'off' | 'track' | 'queue'): string {
    switch (mode) {
      case 'off':
        return 'Disabled';
      case 'track':
        return 'Current Track';
      case 'queue':
        return 'Entire Queue';
      default:
        return 'Unknown';
    }
  }

  private improveImageQuality(artworkUrl: string): string {
    // Use high quality thumbnail for optimal balance of quality and size
    if (artworkUrl.includes('i.ytimg.com')) {
      if (artworkUrl.includes('/hqdefault.jpg')) {
        // Keep high quality (480x360) - optimal balance
        return artworkUrl;
      }
      if (artworkUrl.includes('/default.jpg')) {
        // Upgrade to high quality for better image clarity
        return artworkUrl.replace('/default.jpg', '/hqdefault.jpg');
      }
      if (artworkUrl.includes('/mqdefault.jpg')) {
        // Upgrade to high quality for better image clarity
        return artworkUrl.replace('/mqdefault.jpg', '/hqdefault.jpg');
      }
      if (artworkUrl.includes('/sddefault.jpg')) {
        // Downgrade to high quality for smaller size
        return artworkUrl.replace('/sddefault.jpg', '/hqdefault.jpg');
      }
    }

    // For non-YouTube or already optimized images, return as-is
    return artworkUrl;
  }
}