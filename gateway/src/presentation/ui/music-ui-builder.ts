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
      .setColor('#00ff00')
      .setFooter({
        text: `Requested by ${data.requestedBy.displayName}`,
        iconURL: data.requestedBy.displayAvatarURL()
      })
      .setTimestamp();

    if (data.queuePosition) {
      embed
        .setTitle('🎵 Added to Queue')
        .setDescription(`**${data.trackTitle}**`)
        .addFields({
          name: 'Queue Position',
          value: `${data.queuePosition}`,
          inline: true
        });
    } else {
      embed
        .setTitle('🎵 Now Playing')
        .setDescription(`**${data.trackTitle}**`);
    }

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
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(data.isPaused ? '#ffaa00' : '#00ff00')
      .setTitle(data.isPaused ? '⏸️ Paused' : '🎵 Now Playing')
      .setDescription(`**${data.trackTitle}**`)
      .setTimestamp();

    if (data.artist) {
      embed.addFields({
        name: 'Artist',
        value: data.artist,
        inline: true
      });
    }

    if (data.duration && data.position !== undefined) {
      const progress = this.formatProgress(data.position, data.duration);
      embed.addFields({
        name: 'Progress',
        value: progress,
        inline: true
      });
    }

    embed.addFields(
      {
        name: 'Volume',
        value: `${data.volume}%`,
        inline: true
      },
      {
        name: 'Loop',
        value: this.formatLoopMode(data.loopMode),
        inline: true
      },
      {
        name: 'Queue',
        value: `${data.queueLength} track${data.queueLength !== 1 ? 's' : ''}`,
        inline: true
      }
    );

    return embed;
  }

  buildMusicControlButtons(): ActionRowBuilder<ButtonBuilder>[] {
    // Row 1: Play/Pause, Seek controls, Skip
    const row1 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_playpause')
          .setLabel('⏯️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('music_seek_back')
          .setLabel('⏪ -10s')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_seek_forward')
          .setLabel('⏩ +10s')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_skip')
          .setLabel('⏭️ Skip')
          .setStyle(ButtonStyle.Secondary)
      );

    // Row 2: Volume controls, Loop, Stop
    const row2 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_volume_up')
          .setLabel('🔊 Vol +')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_volume_down')
          .setLabel('🔉 Vol -')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_loop')
          .setLabel('🔁 Loop')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_stop')
          .setLabel('⏹️ Stop')
          .setStyle(ButtonStyle.Danger)
      );

    // Row 3: Queue management, Additional controls
    const row3 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('music_shuffle')
          .setLabel('🔀 Shuffle')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_queue')
          .setLabel('🗒️ Queue')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_clear')
          .setLabel('🧹 Clear')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('music_autoplay')
          .setLabel('▶️ Autoplay')
          .setStyle(ButtonStyle.Secondary)
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
      .setTitle('🗒️ Music Queue')
      .setTimestamp();

    if (data.currentTrack) {
      const progress = data.currentTrack.duration
        ? this.formatProgress(data.currentTrack.position, data.currentTrack.duration)
        : this.formatTime(data.currentTrack.position);

      embed.addFields({
        name: '🎵 Now Playing',
        value: `**${data.currentTrack.title}**\n${progress}`,
        inline: false
      });
    }

    if (data.tracks.length === 0) {
      embed.setDescription('The queue is empty.');
    } else {
      const queueList = data.tracks
        .map((track, index) => {
          const number = (data.page - 1) * 10 + index + 1;
          const duration = track.duration ? ` (${this.formatTime(track.duration)})` : '';
          return `**${number}.** ${track.title}${duration}`;
        })
        .join('\n');

      embed.setDescription(queueList);

      if (data.totalDuration) {
        embed.addFields({
          name: 'Total Duration',
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

    // Simple progress bar
    const barLength = 20;
    const filledLength = Math.round((position / duration) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    return `${positionStr} ${bar} ${durationStr} (${percentage}%)`;
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
}