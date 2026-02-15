import {
  ChatInputCommandInteraction,
  MessageFlags,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { logger } from '@discord-bot/logger';
import { safeValidateCommand } from '@discord-bot/cache';
import type { AudioCommand } from '@discord-bot/audio-control';
import { randomUUID } from 'node:crypto';
import { MusicUIBuilder } from '../ui/music-ui-builder.js';
import { InteractionResponseHandler } from '../ui/interaction-response-handler.js';
import { SettingsService } from '../../services/settings-service.js';
import { DiscordPermissionService } from '../../infrastructure/discord/discord-permission-service.js';
import { subscriptionMiddleware } from '../../middleware/subscription-middleware.js';

import { AudioCommandService } from '../../services/audio-command-service.js';
import { MusicSessionRepository } from '../../domain/repositories/music-session-repository.js';
import { GuildId } from '../../domain/value-objects/guild-id.js';

/**
 * Music Controller
 * Professional implementation for Discord music bot functionality
 */
export class MusicController {
  private readonly reconnectCooldownMs = 15_000;
  private readonly signallingGraceMs = 2_000;
  private readonly reconnectAllowedAtByGuild = new Map<string, number>();

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly eventBus: any, // RedisEventBus
    private readonly uiBuilder: MusicUIBuilder,
    private readonly responseHandler: InteractionResponseHandler,
    private readonly settingsService: SettingsService,
    private readonly permissionService: DiscordPermissionService,
    private readonly musicSessionRepository: MusicSessionRepository,
    private readonly audioCommandService: AudioCommandService,
    private readonly registerProcessingMessage?: (guildId: string, channelId: string, messageId: string, voiceChannelId?: string | null) => void,
    private readonly clearUIBlock?: (guildId: string, channelId: string, voiceChannelId?: string | null) => void,
    private readonly shouldForceVoiceReconnect?: (guildId: string) => boolean,
    private readonly publishCachedVoiceStateUpdate?: (guildId: string, voiceChannelId?: string) => Promise<boolean>,
    private readonly publishCachedVoiceServerUpdate?: (guildId: string) => Promise<void>,
    private readonly registerVoiceRequestContext?: (guildId: string, requestId: string, voiceChannelId: string) => void
  ) {
  }

  private canReconnectVoice(guildId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const allowedAt = this.reconnectAllowedAtByGuild.get(guildId) ?? 0;
    if (allowedAt <= now) {
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: allowedAt - now };
  }

  private markVoiceReconnect(guildId: string): void {
    this.reconnectAllowedAtByGuild.set(guildId, Date.now() + this.reconnectCooldownMs);
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
    } else if (interaction.isButton()) {
      await this.handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await this.handleSelectMenu(interaction);
    }
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    logger.info({
      guildId: interaction.guildId,
      customId,
      userId: interaction.user.id
    }, 'MusicController: Button interaction received');

    // Handle music control buttons
    if (customId.startsWith('music_')) {
      const action = customId.replace('music_', '');
      const [actionType, actionArg] = action.split(':');

      // Map button actions to commands
      switch (actionType) {
        case 'playpause':
          // Use toggle command which is supported by the backend
          await this.handleControlInteraction(interaction, 'toggle');
          break;
        case 'previous':
          await this.handleControlInteraction(interaction, 'previous');
          break;
        case 'skip':
          await this.handleControlInteraction(interaction, 'skip');
          break;
        case 'stop':
          await this.handleControlInteraction(interaction, 'stop');
          break;
        case 'shuffle':
          await this.handleControlInteraction(interaction, 'shuffle');
          break;
        case 'loop':
          await this.handleControlInteraction(interaction, 'loop'); // Need to handle loop toggle
          break;
        case 'queue':
          await this.handleQueueButtonInteraction(interaction, 1, false);
          break;
        case 'queue_prev': {
          const currentPage = Number.parseInt(actionArg ?? '1', 10);
          const page = Number.isFinite(currentPage) ? Math.max(1, currentPage - 1) : 1;
          await this.handleQueueButtonInteraction(interaction, page, true);
          break;
        }
        case 'queue_next': {
          const currentPage = Number.parseInt(actionArg ?? '1', 10);
          const page = Number.isFinite(currentPage) ? Math.max(1, currentPage + 1) : 2;
          await this.handleQueueButtonInteraction(interaction, page, true);
          break;
        }
        case 'clear':
          await this.handleControlInteraction(interaction, 'clear');
          break;
        case 'mute':
          await this.handleControlInteraction(interaction, 'mute');
          break;
        case 'volume_up':
          await this.handleRelativeVolumeInteraction(interaction, 10);
          break;
        case 'volume_down':
          await this.handleRelativeVolumeInteraction(interaction, -10);
          break;
        case 'filters':
          // Open filters logic
          await this.eventBus.publish('discord-bot:panel-commands', JSON.stringify({
            type: 'open_filters',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id
          }));
          await interaction.deferUpdate();
          break;
        case 'autoplay':
          await this.handleAutoplayInteraction(interaction);
          break;
        // Seek buttons
        case 'seek_back_30':
          await this.handleRelativeSeekInteraction(interaction, -30000);
          break;
        case 'seek_forward_30':
          await this.handleRelativeSeekInteraction(interaction, 30000);
          break;
      }

      // Acknowledge interaction if not already handled
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate();
      }
    } else if (customId.startsWith('filters_')) {
      // Handle filter panel buttons
      const action = customId.replace('filters_', '');
      if (action === 'close') {
        await interaction.message.delete();
      } else if (action === 'reset') {
        if (interaction.guildId) {
          await this.audioCommandService.sendCommand('filters', interaction.guildId, {
            action: 'apply',
            preset: 'flat',
            userId: interaction.user.id
          });
        }
        await interaction.deferUpdate();
      }
    }
  }

  async handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    if (interaction.customId === 'filters_select') {
      const selected = interaction.values[0];
      if (interaction.guildId) {
        await this.audioCommandService.sendCommand('filters', interaction.guildId, {
          action: 'apply',
          preset: selected,
          userId: interaction.user.id
        });
      }
      await interaction.deferUpdate();
    }
  }

  private normalizeQueuePayload(queueData: unknown, fallbackPage: number): {
    page: number;
    totalPages: number;
    totalTracks: number;
    tracks: Array<{ title: string; artist?: string; duration?: number; requestedBy: string }>;
  } {
    const payload = typeof queueData === 'object' && queueData !== null
      ? queueData as Record<string, unknown>
      : {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const pageRaw = typeof payload.page === 'number'
      ? payload.page
      : Number.parseInt(String(payload.page ?? ''), 10);
    const totalPagesRaw = typeof payload.totalPages === 'number'
      ? payload.totalPages
      : Number.parseInt(String(payload.totalPages ?? ''), 10);
    const totalTracksRaw = typeof payload.totalTracks === 'number'
      ? payload.totalTracks
      : Number.parseInt(String(payload.totalTracks ?? ''), 10);

    const page = Number.isFinite(pageRaw) ? pageRaw : fallbackPage;
    const parsedTotalPages = Number.isFinite(totalPagesRaw) ? totalPagesRaw : 1;
    const totalPages = Math.max(1, parsedTotalPages);
    const totalTracks = Number.isFinite(totalTracksRaw) ? totalTracksRaw : items.length;

    const tracks = items.map((item, index) => {
      const track = (typeof item === 'object' && item !== null) ? item as Record<string, unknown> : {};
      const title = typeof track.title === 'string' && track.title.trim().length > 0
        ? track.title.trim()
        : `Track ${(page - 1) * 10 + index + 1}`;
      const artist = typeof track.artist === 'string'
        ? track.artist
        : (typeof track.author === 'string' ? track.author : undefined);
      const durationRaw = typeof track.duration === 'number'
        ? track.duration
        : (typeof track.durationMs === 'number' ? track.durationMs : undefined);
      const duration = typeof durationRaw === 'number' && durationRaw > 0 ? durationRaw : undefined;

      return {
        title,
        artist,
        duration,
        requestedBy: 'Queue'
      };
    });

    return { page, totalPages, totalTracks, tracks };
  }

  private async handleQueueButtonInteraction(interaction: ButtonInteraction, page: number, updateExisting: boolean): Promise<void> {
    if (!interaction.guildId) return;

    try {
      const queueData = await this.audioCommandService.sendQueueCommand(interaction.guildId, { page, timeout: 7000 });
      const normalized = this.normalizeQueuePayload(queueData, page);
      const embed = this.uiBuilder.buildQueueEmbed({
        tracks: normalized.tracks,
        page: normalized.page,
        totalPages: normalized.totalPages,
      });
      const components = this.uiBuilder.buildQueueNavigationButtons(normalized.page, normalized.totalPages);

      if (updateExisting) {
        await interaction.update({ embeds: [embed], components });
      } else {
        await interaction.reply({
          embeds: [embed],
          components,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      logger.error({
        error,
        guildId: interaction.guildId,
        page
      }, 'MusicController: Failed to fetch queue');

      if (updateExisting) {
        await interaction.update({
          content: '❌ No pudimos cargar la cola en este momento.',
          embeds: [],
          components: []
        });
      } else {
        await interaction.reply({
          content: '❌ No pudimos cargar la cola en este momento.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }

  private async handleQueueSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) return;

    try {
      const queueData = await this.audioCommandService.sendQueueCommand(interaction.guildId, { page: 1, timeout: 7000 });
      const normalized = this.normalizeQueuePayload(queueData, 1);
      const embed = this.uiBuilder.buildQueueEmbed({
        tracks: normalized.tracks,
        page: normalized.page,
        totalPages: normalized.totalPages,
      });

      await interaction.reply({
        embeds: [embed],
        components: this.uiBuilder.buildQueueNavigationButtons(normalized.page, normalized.totalPages),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logger.error({
        error,
        guildId: interaction.guildId
      }, 'MusicController: Queue slash command failed');
      await interaction.reply({
        content: '❌ No pudimos obtener la cola.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  async handleControlInteraction(interaction: ButtonInteraction, type: AudioCommand): Promise<void> {
    if (!interaction.guildId) return;

    const commandType = type;
    const requestId = randomUUID();
    const startedAt = Date.now();
    const voiceChannelId = interaction.member && 'voice' in interaction.member
      ? interaction.member.voice?.channelId
      : undefined;

    try {
      // Ack immediately to avoid Discord interaction latency.
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      await this.audioCommandService.sendCommand(commandType, interaction.guildId, {
        userId: interaction.user.id,
        requestId
      });

      logger.info({
        guildId: interaction.guildId,
        type: commandType,
        userId: interaction.user.id,
        requestId,
        voiceChannelId,
        latencyMs: Date.now() - startedAt
      }, 'MusicController: Command sent via AudioCommandService');
    } catch (error) {
      logger.error({
        error,
        guildId: interaction.guildId,
        type: commandType,
        requestId,
        voiceChannelId,
        latencyMs: Date.now() - startedAt
      }, 'MusicController: Failed to send command via AudioCommandService');

      if (interaction.deferred && !interaction.replied) {
        await interaction.followUp({
          content: '❌ No pudimos aplicar ese cambio en este momento.',
          flags: MessageFlags.Ephemeral
        }).catch(() => undefined);
      }
    }
  }

  async handleVolumeInteraction(interaction: ButtonInteraction, volume: number): Promise<void> {
    if (!interaction.guildId) return;
    await this.audioCommandService.sendCommand('volume', interaction.guildId, {
      percent: volume.toString()
    });
    await interaction.deferUpdate();
  }

  async handleRelativeVolumeInteraction(interaction: ButtonInteraction, delta: number): Promise<void> {
    if (!interaction.guildId) return;
    const requestId = randomUUID();
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      // Use volumeAdjust command which handles relative volume in Audio service
      await this.audioCommandService.sendCommand('volumeAdjust', interaction.guildId, {
        delta: delta.toString(),
        requestId
      });
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId }, 'Failed to handle relative volume interaction');
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
    }
  }

  async handleAutoplayInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) return;
    const requestId = randomUUID();
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      // Delegate autoplay toggle/cycling to Audio service
      await this.audioCommandService.sendCommand('autoplay', interaction.guildId, { requestId });
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId }, 'Failed to handle autoplay interaction');
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
    }
  }

  async handleRelativeSeekInteraction(interaction: ButtonInteraction, deltaMs: number): Promise<void> {
    if (!interaction.guildId) return;
    const requestId = randomUUID();
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      // Use seekAdjust command which handles relative seeking in Audio service
      await this.audioCommandService.sendCommand('seekAdjust', interaction.guildId, {
        deltaMs: deltaMs.toString(),
        requestId
      });
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId }, 'Failed to handle relative seek interaction');
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
    }
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.commandName;

    switch (commandName) {
      case 'play':
        await this.handlePlayCommand(interaction);
        break;
      case 'pause':
        await this.handleControlCommand(interaction, 'PAUSE');
        break;
      case 'resume':
        await this.handleControlCommand(interaction, 'RESUME');
        break;
      case 'stop':
        await this.handleControlCommand(interaction, 'STOP');
        break;
      case 'skip':
        await this.handleControlCommand(interaction, 'SKIP');
        break;
      case 'queue':
        await this.handleControlCommand(interaction, 'QUEUE');
        break;
      case 'nowplaying':
        await this.handleControlCommand(interaction, 'nowplaying');
        break;
      case 'volume':
        await this.handleVolumeCommand(interaction);
        break;
      case 'loop':
        await this.handleLoopCommand(interaction);
        break;
      case 'shuffle':
        await this.handleControlCommand(interaction, 'SHUFFLE');
        break;
      case 'clear':
        await this.handleControlCommand(interaction, 'CLEAR');
        break;
      default:
        await interaction.reply({ content: '❌ Unknown music command', flags: MessageFlags.Ephemeral });
    }
  }

  async handlePlayCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handlePlayTypeCommand(interaction, 'play');
  }

  async handleControlCommand(interaction: ChatInputCommandInteraction, type: string): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    // Check DJ permissions for control commands
    const hasPermission = await this.checkDJPermissions(interaction);
    if (!hasPermission) {
      return; // Permission check already sent response
    }

    try {
      // Map command types to lowercase format expected by audio service
      const commandTypeMap: Record<string, string> = {
        'PAUSE': 'pause',
        'RESUME': 'resume',
        'STOP': 'stop',
        'SKIP': 'skip',
        'QUEUE': 'queue',
        'SHUFFLE': 'shuffle',
        'CLEAR': 'clear',
        'nowplaying': 'nowplaying'
      };

      const audioServiceType = commandTypeMap[type] || type.toLowerCase();

      // Validate command before publishing
      // We can skip validation here as AudioCommandService handles it or Audio service will reject it

      if (audioServiceType === 'nowplaying') {
        await interaction.reply({ content: `🎵 Getting now playing info...`, flags: MessageFlags.Ephemeral });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.audioCommandService as any).sendNowPlayingCommand(interaction.guildId, interaction.channelId);
      } else if (audioServiceType === 'queue') {
        await this.handleQueueSlashCommand(interaction);
      } else {
        await interaction.reply({ content: `🎵 ${audioServiceType} command sent...`, flags: MessageFlags.Ephemeral });

        if (['skip', 'pause', 'resume', 'toggle', 'stop', 'shuffle', 'clear', 'previous', 'mute'].includes(audioServiceType)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await this.audioCommandService.sendSimpleCommand(audioServiceType as any, interaction.guildId);
        } else {
          await this.audioCommandService.sendCommand(audioServiceType as AudioCommand, interaction.guildId, {
            userId: interaction.user.id
          });
        }
      }
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId, type }, 'Failed to process control command');
      // Only reply if we haven't already
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Failed to process command.', flags: MessageFlags.Ephemeral });
      }
    }
  }

  async handleVolumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const volume = interaction.options.getInteger('level', true);

    try {
      const commandData = {
        type: 'volume',
        guildId: interaction.guildId,
        percent: volume
      };

      // Validate command before publishing
      const validationResult = safeValidateCommand(commandData);
      if ('error' in validationResult && !validationResult.success) {
        logger.error({
          guildId: interaction.guildId,
          type: 'volume',
          volume,
          validationError: (validationResult as { success: false; error: string }).error
        }, 'Volume command validation failed');
        await interaction.reply({ content: '❌ Volume command validation failed.', flags: MessageFlags.Ephemeral });
        return;
      }

      await this.audioCommandService.sendCommand('volume', interaction.guildId, {
        percent: volume.toString()
      });
      await interaction.reply({ content: `🔊 Setting volume to ${volume}%...`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Failed to set volume.', flags: MessageFlags.Ephemeral });
    }
  }


  async handleLoopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const mode = interaction.options.getString('mode', true);

    try {
      if (mode) {
        await this.audioCommandService.sendCommand('loopSet', interaction.guildId, {
          mode: mode
        });
      } else {
        await this.audioCommandService.sendSimpleCommand('loop' as any, interaction.guildId);
      }
      await interaction.reply({ content: `🔁 Setting loop mode to: ${mode || 'cycle'}...`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Failed to set loop mode.', flags: MessageFlags.Ephemeral });
    }
  }


  async handleShuffleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'SHUFFLE');
  }

  async handleClearCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'CLEAR');
  }

  async handlePauseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'PAUSE');
  }

  async handleResumeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'RESUME');
  }

  async handleStopCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'STOP');
  }

  async handleQueueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'QUEUE');
  }

  async handlePlayNextCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handlePlayTypeCommand(interaction, 'playnext');
  }

  async handlePlayNowCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handlePlayTypeCommand(interaction, 'playnow');
  }

  /**
   * Generic play command handler for different play types
   * Implements Discord 5-Rule message management system
   */
  private async handlePlayTypeCommand(interaction: ChatInputCommandInteraction, commandType: 'play' | 'playnext' | 'playnow'): Promise<void> {
    const requestId = randomUUID();
    logger.info({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      commandType,
      channelId: interaction.channelId,
      requestId
    }, `GATEWAY_MUSIC: ${commandType} command received`);

    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    // Check subscription limits - monthly tracks usage
    const limitCheck = await subscriptionMiddleware.checkUsageLimit(
      interaction,
      'monthly_tracks',
      { incrementAmount: 1, showUpgradePrompt: true }
    );

    if (!limitCheck.allowed) {
      // Error message already sent by middleware
      return;
    }

    const query = interaction.options.getString('query', true);

    try {
      logger.info({ guildId: interaction.guildId, commandType, requestId }, 'DEBUG: Starting music command processing');

      // Get user's voice channel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const member = interaction.member as any;
      const voiceChannel = member?.voice?.channel;

      if (!voiceChannel) {
        logger.info({ guildId: interaction.guildId, commandType, requestId }, 'DEBUG: User not in voice channel - early return');
        await interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
        return;
      }

      logger.info({ guildId: interaction.guildId, commandType, voiceChannelId: voiceChannel.id, requestId }, 'DEBUG: User in voice channel, continuing');
      this.registerVoiceRequestContext?.(interaction.guildId, requestId, voiceChannel.id);

      // DISCORD 5-RULE MESSAGE MANAGEMENT SYSTEM
      // Rule 1: Only one visible UI PRINCIPAL message per channel
      // Rule 2: ALL messages except UI PRINCIPAL must be ephemeral
      // Rule 3: Deleting UI PRINCIPAL must disconnect bot immediately
      // Rule 4: Disconnecting bot must delete UI PRINCIPAL message
      // Rule 5: Ephemeral messages only when setting is ON

      const _shouldUseEphemeral = await this.shouldUseEphemeral(interaction.guildId);

      // CRITICAL FIX: Clear UI block for new legitimate commands to allow UI recreation
      if (this.clearUIBlock) {
        this.clearUIBlock(interaction.guildId, interaction.channelId, voiceChannel.id);
      }

      // Determine if this is the first track by checking if bot is already connected to voice
      const isFirstTrack = await this.isFirstTrack(interaction.guildId);

      // FIXED: Use simple ephemeral replies that auto-disappear
      if (commandType === 'playnow') {
        // /playnow: Silent execution per documentation
        await interaction.deferReply({ ephemeral: true });
      } else {
        // /play and /playnext: Show processing message that will be deleted
        await interaction.reply({
          content: '🎵 Processing...',
          flags: MessageFlags.Ephemeral
        });

        // Auto-delete processing message after 3 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
            logger.debug({
              guildId: interaction.guildId,
              userId: interaction.user.id,
              commandType
            }, 'Auto-deleted ephemeral processing message');
          } catch (error) {
            // Ignore deletion errors (message might already be gone)
            logger.debug({
              guildId: interaction.guildId,
              error: error instanceof Error ? error.message : String(error)
            }, 'Processing message auto-deletion failed (likely already gone)');
          }
        }, 3000);
      }

      // CRITICAL: Connect Discord.js to voice channel FIRST before sending command to audio service
      // This applies to ALL music commands: /play, /playnext, /playnow
      logger.info({ guildId: interaction.guildId, commandType, isFirstTrack, requestId }, 'DEBUG: About to attempt voice connection');
      try {
        const { joinVoiceChannel, VoiceConnectionStatus, entersState } = await import('@discordjs/voice');
        const existingConnection = getVoiceConnection(interaction.guildId);
        const existingState = existingConnection?.state.status ?? 'unknown';

        // Check if connection exists AND is in a valid state (connected/ready/connecting).
        let isValidConnection = Boolean(
          existingConnection &&
          (existingConnection.state.status === VoiceConnectionStatus.Ready ||
            existingConnection.state.status === VoiceConnectionStatus.Connecting)
        );

        let connection = existingConnection ?? null;

        if (existingConnection && existingState === VoiceConnectionStatus.Signalling) {
          logger.warn({
            guildId: interaction.guildId,
            commandType,
            requestId,
            existingState
          }, 'VOICE_CONNECT: Existing connection is signalling; waiting briefly before reconnect');

          try {
            await entersState(existingConnection, VoiceConnectionStatus.Ready, this.signallingGraceMs);
            isValidConnection = true;
            logger.info({
              guildId: interaction.guildId,
              commandType,
              requestId
            }, 'VOICE_CONNECT: Signalling connection recovered without reconnect');
          } catch (error) {
            logger.warn({
              guildId: interaction.guildId,
              commandType,
              requestId,
              existingState,
              error: error instanceof Error ? error.message : String(error)
            }, 'VOICE_CONNECT: Signalling connection did not recover in grace window');
          }
        }

        // If we don't have cached voice server data, force a fresh reconnect to trigger VOICE_SERVER_UPDATE
        if (isValidConnection && this.shouldForceVoiceReconnect?.(interaction.guildId)) {
          const decision = this.canReconnectVoice(interaction.guildId);
          if (!decision.allowed) {
            logger.warn({
              guildId: interaction.guildId,
              commandType,
              requestId,
              retryAfterMs: decision.retryAfterMs
            }, 'VOICE_CONNECT: Skipping forced reconnect due to cooldown');
          } else {
            logger.info({
              guildId: interaction.guildId,
              commandType,
              requestId,
              reason: 'missing_voice_server_cache'
            }, 'VOICE_CONNECT: Forcing reconnect to refresh voice server data');
            try {
              existingConnection?.destroy();
              this.markVoiceReconnect(interaction.guildId);
            } catch (error) {
              logger.warn({
                error,
                guildId: interaction.guildId,
                requestId
              }, 'VOICE_CONNECT: Failed to destroy existing connection during forced reconnect');
            }
            connection = null;
            isValidConnection = false;
          }
        }

        if (!isValidConnection) {
          let shouldCreateNewConnection = true;

          if (existingConnection) {
            const decision = this.canReconnectVoice(interaction.guildId);
            logger.info({
              guildId: interaction.guildId,
              oldState: existingState,
              commandType,
              requestId,
              reason: `state_${existingState}`
            }, 'VOICE_CONNECT: Existing connection not valid for playback');

            if (!decision.allowed) {
              shouldCreateNewConnection = false;
              connection = existingConnection;
              logger.warn({
                guildId: interaction.guildId,
                commandType,
                requestId,
                retryAfterMs: decision.retryAfterMs
              }, 'VOICE_CONNECT: Reconnect cooldown active, reusing current connection');
            } else {
              try {
                existingConnection.destroy();
                this.markVoiceReconnect(interaction.guildId);
              } catch (error) {
                logger.warn({
                  error,
                  guildId: interaction.guildId,
                  requestId
                }, 'VOICE_CONNECT: Failed to destroy stale connection');
              }
            }
          }

          if (shouldCreateNewConnection) {
            connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: interaction.guildId,
              adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              selfDeaf: true
            });

            logger.info({
              guildId: interaction.guildId,
              voiceChannelId: voiceChannel.id,
              commandType,
              requestId,
              isReconnection: !!existingConnection
            }, `VOICE_CONNECT: Discord.js ${existingConnection ? 'reconnected' : 'connected'} to voice channel for ${commandType}`);
          }
        } else {
          logger.info({
            guildId: interaction.guildId,
            currentState: existingState,
            commandType,
            requestId
          }, `VOICE_CONNECT: Already connected (${existingState}), skipping connection for ${commandType}`);
        }

        if (connection) {
          let cachedVoiceStatePublished = false;
          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            logger.info({ guildId: interaction.guildId, commandType, requestId }, 'VOICE_CONNECT: Voice connection ready');
            if (this.publishCachedVoiceStateUpdate) {
              cachedVoiceStatePublished = await this.publishCachedVoiceStateUpdate(interaction.guildId, voiceChannel.id);
            }
            if (this.publishCachedVoiceServerUpdate) {
              await this.publishCachedVoiceServerUpdate(interaction.guildId);
            }

            // If we cannot provide sessionId on reused connections, reconnect once to force fresh Discord voice events.
            if (!cachedVoiceStatePublished) {
              const decision = this.canReconnectVoice(interaction.guildId);
              logger.warn({
                guildId: interaction.guildId,
                commandType,
                requestId,
                retryAfterMs: decision.retryAfterMs
              }, 'VOICE_CONNECT: Missing sessionId after ready state, forcing one reconnect');

              if (decision.allowed) {
                try {
                  connection.destroy();
                  this.markVoiceReconnect(interaction.guildId);
                } catch (error) {
                  logger.warn({
                    error,
                    guildId: interaction.guildId,
                    requestId
                  }, 'VOICE_CONNECT: Failed to destroy connection before forced reconnect');
                }

                connection = joinVoiceChannel({
                  channelId: voiceChannel.id,
                  guildId: interaction.guildId,
                  adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                  selfDeaf: true
                });

                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                logger.info({ guildId: interaction.guildId, commandType, requestId }, 'VOICE_CONNECT: Forced reconnect is ready');
              } else {
                logger.warn({
                  guildId: interaction.guildId,
                  commandType,
                  requestId,
                  retryAfterMs: decision.retryAfterMs
                }, 'VOICE_CONNECT: Skipping forced reconnect due to cooldown');
              }

              if (this.publishCachedVoiceStateUpdate) {
                cachedVoiceStatePublished = await this.publishCachedVoiceStateUpdate(interaction.guildId, voiceChannel.id);
              }
              if (this.publishCachedVoiceServerUpdate) {
                await this.publishCachedVoiceServerUpdate(interaction.guildId);
              }
            }

            if (!cachedVoiceStatePublished) {
              logger.error({
                guildId: interaction.guildId,
                commandType,
                requestId
              }, 'VOICE_CONNECT: Could not publish cached VOICE_STATE_UPDATE after reconnect');
              if (interaction.deferred) {
                await interaction.editReply({ content: '❌ Voice session sync failed. Please retry /play.' });
              } else {
                await interaction.followUp({ content: '❌ Voice session sync failed. Please retry /play.', ephemeral: true });
              }
              return;
            }
          } catch (error) {
            logger.error({
              error: error instanceof Error ? error.message : String(error),
              guildId: interaction.guildId,
              commandType,
              requestId
            }, 'VOICE_CONNECT: Timed out waiting for voice connection ready');

            if (interaction.deferred) {
              await interaction.editReply({ content: '❌ Failed to connect to voice channel.' });
            } else {
              await interaction.followUp({ content: '❌ Failed to connect to voice channel.', ephemeral: true });
            }
            return;
          }
        }
      } catch (voiceError) {
        logger.error({
          error: voiceError instanceof Error ? voiceError.message : String(voiceError),
          guildId: interaction.guildId,
          commandType,
          requestId
        }, `VOICE_CONNECT: Failed to connect Discord.js to voice channel for ${commandType}`);
      }

      // NOW send command to audio service after voice connection is established
      const publishedRequestId = await this.audioCommandService.sendPlayCommand(
        commandType,
        interaction.guildId,
        voiceChannel.id,
        interaction.channelId,
        interaction.user.id,
        query
      );
      logger.info({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        requestId: publishedRequestId,
        commandType
      }, 'GATEWAY_MUSIC: forwarded slash play command to audio');

      // For playnow, update the deferred reply only if it was deferred
      if (commandType === 'playnow' && interaction.deferred) {
        await interaction.editReply({ content: '🎵 Playing immediately...' });
      }

    } catch (error) {
      // Use proper logger instead of console.error
      logger.error({ error, guildId: interaction.guildId, commandType, requestId }, 'Error in handlePlayTypeCommand');
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: '❌ Failed to process play command.' });
        } else if (!interaction.replied) {
          await interaction.reply({ content: '❌ Failed to process play command.', flags: MessageFlags.Ephemeral });
        }
        // If interaction was already replied to, we can't send another response
      } catch (replyError) {
        logger.error({ error: replyError, guildId: interaction.guildId }, 'Failed to send error reply');
      }
    }
  }

  // Missing command handlers that were added to main.ts
  async handleSkipCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleControlCommand(interaction, 'skip');
  }

  async handleRemoveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const index = interaction.options.getInteger('index', true);

    try {
      await this.audioCommandService.sendCommand('remove', interaction.guildId, {
        channelId: interaction.channelId,
        userId: interaction.user.id,
        index: index.toString(),
        timestamp: Date.now().toString()
      });
      await interaction.reply({ content: `🗑️ Removing track at position ${index}...`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Failed to remove track.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleMoveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.audioCommandService.sendCommand('move', interaction.guildId, {
        from: from.toString(),
        to: to.toString()
      });
      await interaction.reply({ content: `↕️ Moving track from position ${from} to ${to}...`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Failed to move track.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleSeekCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const seconds = interaction.options.getInteger('seconds', true);

    try {
      await this.audioCommandService.sendCommand('seek', interaction.guildId, {
        channelId: interaction.channelId,
        userId: interaction.user.id,
        position: (seconds * 1000).toString(), // Convert to milliseconds
        timestamp: Date.now().toString()
      });
      await interaction.reply({ content: `⏩ Seeking to ${seconds} seconds...`, flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({ content: '❌ Failed to seek.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleSettingsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'button-feedback': {
          const enabled = interaction.options.getBoolean('enabled', true);
          await this.settingsService.updateSetting(interaction.guildId, 'ephemeralMessages', enabled);
          await interaction.reply({
            content: `⚙️ Button feedback messages: ${enabled ? '✅ Enabled' : '❌ Disabled'}`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        case 'dj-role': {
          const role = interaction.options.getRole('role', true);
          await this.settingsService.updateSetting(interaction.guildId, 'djRoleId', role.id);
          await interaction.reply({
            content: `⚙️ DJ role set to: ${role.name}`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        case 'djonly-mode': {
          const djOnlyEnabled = interaction.options.getBoolean('enabled', true);
          await this.settingsService.updateSetting(interaction.guildId, 'djOnlyMode', djOnlyEnabled);
          await interaction.reply({
            content: `⚙️ DJ Only mode: ${djOnlyEnabled ? '🔒 **Enabled**' : '🔓 **Disabled**'}`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        case 'voteskip-enabled': {
          const voteSkipEnabled = interaction.options.getBoolean('enabled', true);
          await this.settingsService.updateSetting(interaction.guildId, 'voteSkipEnabled', voteSkipEnabled);
          await interaction.reply({
            content: `⚙️ Vote skip: ${voteSkipEnabled ? '✅ **Enabled**' : '❌ **Disabled**'}`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        case 'voteskip-threshold': {
          const threshold = interaction.options.getNumber('threshold', true);
          // Convert percentage (1-100) to decimal (0.01-1.0)
          const thresholdDecimal = threshold / 100;

          await this.settingsService.updateSetting(interaction.guildId, 'voteSkipThreshold', thresholdDecimal);
          await interaction.reply({
            content: `⚙️ Vote skip threshold set to **${threshold}%** (${Math.ceil(2 * thresholdDecimal)} votes needed for 2 users)`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        case 'autoplay': {
          const autoplayMode = interaction.options.getString('mode', true);
          const autoplayCommandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'autoplayMode',
            value: autoplayMode,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(autoplayCommandData));
          await interaction.reply({
            content: `⚙️ Autoplay mode set to: ${autoplayMode}`,
            flags: MessageFlags.Ephemeral
          });
          break;
        }

        default:
          await interaction.reply({ content: '❌ Unknown settings subcommand.', flags: MessageFlags.Ephemeral });
      }
    } catch {
      await interaction.reply({ content: '❌ Failed to update settings.', flags: MessageFlags.Ephemeral });
    }
  }

  private async isFirstTrack(guildId: string): Promise<boolean> {
    // Check if bot is already connected to voice in this guild
    const voiceConnection = getVoiceConnection(guildId);

    // If no voice connection exists, this is definitely the first track
    if (!voiceConnection) {
      return true;
    }

    // If connection exists but is not ready/connected, consider it first track
    const isConnected = voiceConnection.state.status === 'ready' ||
      voiceConnection.state.status === 'connecting';

    // If not connected, this is the first track
    return !isConnected;
  }

  async handleAutoplayCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const mode = interaction.options.getString('mode');
      const settings = await this.settingsService.getGuildSettings(interaction.guildId);

      if (!mode) {
        // Toggle autoplay on/off
        const newState = !settings.autoplayEnabled;

        // Save to database directly
        await this.settingsService.updateSetting(interaction.guildId, 'autoplayEnabled', newState);

        const statusEmoji = newState ? '✅' : '❌';
        const currentMode = settings.autoplayMode || 'similar';
        await interaction.reply({
          content: newState
            ? `${statusEmoji} **Autoplay enabled** with mode: **${currentMode}**\n💡 Use \`/autoplay mode:[mode]\` to change mode`
            : `${statusEmoji} **Autoplay disabled**`,
          flags: MessageFlags.Ephemeral
        });
      } else if (mode === 'off') {
        // Disable autoplay
        await this.settingsService.updateSetting(interaction.guildId, 'autoplayEnabled', false);

        await interaction.reply({
          content: '❌ **Autoplay disabled**',
          flags: MessageFlags.Ephemeral
        });
      } else {
        // Set mode and enable autoplay
        await this.settingsService.updateSetting(interaction.guildId, 'autoplayMode', mode);
        await this.settingsService.updateSetting(interaction.guildId, 'autoplayEnabled', true);

        const modeDescriptions: Record<string, string> = {
          'similar': '🎵 Similar tracks',
          'artist': '👤 Same artist',
          'genre': '🎸 Same genre',
          'mixed': '🔀 Mixed (artist + genre + similar)'
        };

        await interaction.reply({
          content: `✅ **Autoplay enabled** with mode: **${modeDescriptions[mode] || mode}**`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch {
      await interaction.reply({ content: '❌ Failed to update autoplay settings.', flags: MessageFlags.Ephemeral });
    }
  }

  private async shouldUseEphemeral(guildId: string): Promise<boolean> {
    // Rule 5: Ephemeral messages only when setting is ON
    try {
      const settings = await this.settingsService.getGuildSettings(guildId);
      return settings.ephemeralMessages;
    } catch (error) {
      // Use proper logger instead of console.error
      logger.error({ error, guildId }, 'Failed to get guild settings for ephemeral check');
      // Default to false on error for better UX
      return false;
    }
  }

  /**
   * Check if user has DJ permissions to control music
   * Returns true if user has permission, false if denied (and sends response)
   */
  private async checkDJPermissions(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guildId) {
      return false;
    }

    try {
      // Get guild settings to check DJ configuration
      const settings = await this.settingsService.getGuildSettings(interaction.guildId);

      // Get user roles
      const userRoles = await this.permissionService.getUserRoles(interaction.user.id, interaction.guildId);

      // Find DJ role name if set
      let djRoleName: string | null = null;
      if (settings.djRoleId) {
        try {
          const guild = await interaction.client.guilds.fetch(interaction.guildId);
          const djRole = await guild.roles.fetch(settings.djRoleId);
          djRoleName = djRole?.name || null;
        } catch (error) {
          logger.warn({ error, guildId: interaction.guildId, djRoleId: settings.djRoleId }, 'Failed to fetch DJ role');
        }
      }

      // Check if user has permission to control music
      const hasPermission = await this.permissionService.hasPermissionToControlMusic(
        interaction.user.id,
        interaction.guildId,
        userRoles,
        djRoleName
      );

      if (!hasPermission) {
        // Send denial message
        let message = '🚫 You need DJ permissions to use this command.';
        if (djRoleName) {
          message = `🚫 You need the **${djRoleName}** role or administrative permissions to use this command.`;
        } else if (settings.djOnlyMode) {
          message = '🚫 This server has DJ-only mode enabled. Contact an administrator to configure DJ roles.';
        }

        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral
        });

        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error, guildId: interaction.guildId, userId: interaction.user.id }, 'Failed to check DJ permissions');

      // On error, allow the command but log it
      await interaction.reply({
        content: '⚠️ Permission check failed. Command will proceed.',
        flags: MessageFlags.Ephemeral
      });

      return true;
    }
  }
}
