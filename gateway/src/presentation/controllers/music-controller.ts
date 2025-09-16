import { CommandInteraction, ChatInputCommandInteraction } from 'discord.js';
import { PlayMusicUseCase } from '../../application/use-cases/play-music-use-case.js';
import { ControlMusicUseCase } from '../../application/use-cases/control-music-use-case.js';
import {
  PlayMusicCommand,
  PauseMusicCommand,
  ResumeMusicCommand,
  StopMusicCommand,
  SetVolumeCommand,
  SetLoopModeCommand
} from '../../application/commands/play-music-command.js';
import { MusicUIBuilder } from '../ui/music-ui-builder.js';
import { InteractionResponseHandler } from '../ui/interaction-response-handler.js';

/**
 * Music Controller
 * Handles Discord interactions for music commands
 */
export class MusicController {
  constructor(
    private readonly playMusicUseCase: PlayMusicUseCase,
    private readonly controlMusicUseCase: ControlMusicUseCase,
    private readonly musicUIBuilder: MusicUIBuilder,
    private readonly responseHandler: InteractionResponseHandler
  ) {}

  async handlePlayCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Validate user is in voice channel
      const member = interaction.member;
      if (!member || !('voice' in member) || !member.voice.channel) {
        await this.responseHandler.sendError(
          interaction,
          'You must be in a voice channel to play music.'
        );
        return;
      }

      const query = interaction.options.getString('query', true);
      const voiceChannelId = member.voice.channel.id;
      const textChannelId = interaction.channelId;

      // Get user roles
      const userRoles = 'roles' in member
        ? member.roles.cache.map(role => role.name)
        : [];

      // Check if user is alone in voice channel
      const isUserAloneInChannel = member.voice.channel.members.filter(m => !m.user.bot).size === 1;

      const command = PlayMusicCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        query,
        voiceChannelId,
        textChannelId,
        userRoles,
        isUserAloneInChannel
      });

      const result = await this.playMusicUseCase.execute(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildPlaySuccessEmbed({
          trackTitle: result.trackTitle!,
          queuePosition: result.queuePosition,
          requestedBy: interaction.user
        });

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

      // Publish domain events if needed
      // this.eventPublisher.publishEvents(result.events);

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while processing your request.'
      );
    }
  }

  async handlePauseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const userRoles = this.getUserRoles(interaction);

      const command = PauseMusicCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        userRoles
      });

      const result = await this.controlMusicUseCase.pauseMusic(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildControlSuccessEmbed(
          'Paused',
          result.message,
          interaction.user
        );

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while pausing music.'
      );
    }
  }

  async handleResumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const userRoles = this.getUserRoles(interaction);

      const command = ResumeMusicCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        userRoles
      });

      const result = await this.controlMusicUseCase.resumeMusic(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildControlSuccessEmbed(
          'Resumed',
          result.message,
          interaction.user
        );

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while resuming music.'
      );
    }
  }

  async handleStopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const userRoles = this.getUserRoles(interaction);

      const command = StopMusicCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        userRoles,
        reason: 'user_requested'
      });

      const result = await this.controlMusicUseCase.stopMusic(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildControlSuccessEmbed(
          'Stopped',
          result.message,
          interaction.user
        );

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while stopping music.'
      );
    }
  }

  async handleVolumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const volume = interaction.options.getInteger('volume', true);

      if (volume < 0 || volume > 200) {
        await this.responseHandler.sendError(
          interaction,
          'Volume must be between 0 and 200.'
        );
        return;
      }

      const userRoles = this.getUserRoles(interaction);

      const command = SetVolumeCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        volume,
        userRoles
      });

      const result = await this.controlMusicUseCase.setVolume(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildControlSuccessEmbed(
          'Volume Changed',
          result.message,
          interaction.user
        );

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while setting volume.'
      );
    }
  }

  async handleLoopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const mode = interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';

      const userRoles = this.getUserRoles(interaction);

      const command = SetLoopModeCommand.create({
        guildId: interaction.guildId!,
        userId: interaction.user.id,
        loopMode: mode,
        userRoles
      });

      const result = await this.controlMusicUseCase.setLoopMode(command);

      if (result.success) {
        const embed = this.musicUIBuilder.buildControlSuccessEmbed(
          'Loop Mode Changed',
          result.message,
          interaction.user
        );

        await this.responseHandler.sendSuccess(interaction, {
          embeds: [embed]
        });
      } else {
        await this.responseHandler.sendError(interaction, result.message);
      }

    } catch (error) {
      await this.responseHandler.sendError(
        interaction,
        'An unexpected error occurred while setting loop mode.'
      );
    }
  }

  private getUserRoles(interaction: CommandInteraction): string[] {
    const member = interaction.member;
    if (!member || !('roles' in member)) {
      return [];
    }
    return member.roles.cache.map(role => role.name);
  }
}