import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { logger } from '@discord-bot/logger';
import { MusicUIBuilder } from '../ui/music-ui-builder.js';
import { InteractionResponseHandler } from '../ui/interaction-response-handler.js';
import { SettingsService } from '../../services/settings-service.js';
import { DiscordPermissionService } from '../../infrastructure/discord/discord-permission-service.js';

/**
 * Music Controller
 * Professional implementation for Discord music bot functionality
 */
export class MusicController {

  constructor(
    private readonly eventBus: any, // RedisEventBus
    private readonly uiBuilder: MusicUIBuilder,
    private readonly responseHandler: InteractionResponseHandler,
    private readonly settingsService: SettingsService,
    private readonly permissionService: DiscordPermissionService,
    private readonly registerProcessingMessage?: (guildId: string, channelId: string, messageId: string) => void,
    private readonly clearUIBlock?: (guildId: string, channelId: string) => void
  ) {
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

      const commandData = {
        type: audioServiceType,
        guildId: interaction.guildId,
        ...((['nowplaying', 'queue'].includes(audioServiceType)) && {
          requestId: `${audioServiceType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }),
        ...(audioServiceType === 'nowplaying' && {
          channelId: interaction.channelId
        })
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));

      if (audioServiceType === 'nowplaying') {
        await interaction.reply({ content: `🎵 Getting now playing info...`, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: `🎵 ${audioServiceType} command sent...`, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      await interaction.reply({ content: '❌ Failed to process command.', flags: MessageFlags.Ephemeral });
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

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
      await interaction.reply({ content: `🔊 Setting volume to ${volume}%...`, flags: MessageFlags.Ephemeral });
    } catch (error) {
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
      const commandData = mode ? {
        type: 'loopSet',
        guildId: interaction.guildId,
        mode: mode
      } : {
        type: 'loop',
        guildId: interaction.guildId
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
      await interaction.reply({ content: `🔁 Setting loop mode to: ${mode || 'cycle'}...`, flags: MessageFlags.Ephemeral });
    } catch (error) {
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
    logger.info({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      commandType
    }, `GATEWAY_MUSIC: ${commandType} command received`);

    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const query = interaction.options.getString('query', true);

    try {
      logger.info({ guildId: interaction.guildId, commandType }, 'DEBUG: Starting music command processing');

      // Get user's voice channel
      const member = interaction.member as any;
      const voiceChannel = member?.voice?.channel;

      if (!voiceChannel) {
        logger.info({ guildId: interaction.guildId, commandType }, 'DEBUG: User not in voice channel - early return');
        await interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
        return;
      }

      logger.info({ guildId: interaction.guildId, commandType, voiceChannelId: voiceChannel.id }, 'DEBUG: User in voice channel, continuing');

      // DISCORD 5-RULE MESSAGE MANAGEMENT SYSTEM
      // Rule 1: Only one visible UI PRINCIPAL message per channel
      // Rule 2: ALL messages except UI PRINCIPAL must be ephemeral
      // Rule 3: Deleting UI PRINCIPAL must disconnect bot immediately
      // Rule 4: Disconnecting bot must delete UI PRINCIPAL message
      // Rule 5: Ephemeral messages only when setting is ON

      const shouldUseEphemeral = await this.shouldUseEphemeral(interaction.guildId);

      // CRITICAL FIX: Clear UI block for new legitimate commands to allow UI recreation
      if (this.clearUIBlock) {
        this.clearUIBlock(interaction.guildId, interaction.channelId);
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
      logger.info({ guildId: interaction.guildId, commandType, isFirstTrack }, 'DEBUG: About to attempt voice connection');
      try {
        const existingConnection = getVoiceConnection(interaction.guildId);

        if (!existingConnection) {
          const { joinVoiceChannel } = await import('@discordjs/voice');

          joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
          });

          logger.info({
            guildId: interaction.guildId,
            voiceChannelId: voiceChannel.id,
            commandType
          }, `VOICE_CONNECT: Discord.js connected to voice channel for ${commandType}`);
        } else {
          logger.debug({
            guildId: interaction.guildId,
            commandType
          }, `VOICE_CONNECT: Already connected, skipping connection for ${commandType}`);
        }
      } catch (voiceError) {
        logger.error({
          error: voiceError instanceof Error ? voiceError.message : String(voiceError),
          guildId: interaction.guildId,
          commandType
        }, `VOICE_CONNECT: Failed to connect Discord.js to voice channel for ${commandType}`);
      }

      // NOW send command to audio service after voice connection is established
      const commandData = {
        type: commandType,
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        userId: interaction.user.id,
        query: query
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));

      // For playnow, update the deferred reply only if it was deferred
      if (commandType === 'playnow' && interaction.deferred) {
        await interaction.editReply({ content: '🎵 Playing immediately...' });
      }

    } catch (error) {
      // Use proper logger instead of console.error
      logger.error({ error, guildId: interaction.guildId, commandType }, 'Error in handlePlayTypeCommand');
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
    await this.handleControlCommand(interaction, 'SKIP');
  }

  async handleRemoveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const index = interaction.options.getInteger('index', true);

    try {
      const commandData = {
        type: 'REMOVE_TRACK',
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        index: index,
        timestamp: Date.now()
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
      await interaction.reply({ content: `🗑️ Removing track at position ${index}...`, flags: MessageFlags.Ephemeral });
    } catch (error) {
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
      const commandData = {
        type: 'move',
        guildId: interaction.guildId,
        from: from,
        to: to
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
      await interaction.reply({ content: `↕️ Moving track from position ${from} to ${to}...`, flags: MessageFlags.Ephemeral });
    } catch (error) {
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
      const commandData = {
        type: 'SEEK',
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        position: seconds * 1000, // Convert to milliseconds
        timestamp: Date.now()
      };

      await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
      await interaction.reply({ content: `⏩ Seeking to ${seconds} seconds...`, flags: MessageFlags.Ephemeral });
    } catch (error) {
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
        case 'button-feedback':
          const enabled = interaction.options.getBoolean('enabled', true);
          const commandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'ephemeralMessages',
            value: enabled,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(commandData));
          await interaction.reply({
            content: `⚙️ Button feedback messages: ${enabled ? '✅ Enabled' : '❌ Disabled'}`,
            flags: MessageFlags.Ephemeral
          });
          break;

        case 'dj-role':
          const role = interaction.options.getRole('role', true);
          const djCommandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'djRole',
            value: role.id,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(djCommandData));
          await interaction.reply({
            content: `⚙️ DJ role set to: ${role.name}`,
            flags: MessageFlags.Ephemeral
          });
          break;

        case 'djonly-mode':
          const djOnlyEnabled = interaction.options.getBoolean('enabled', true);
          const djOnlyCommandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'djOnlyMode',
            value: djOnlyEnabled,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(djOnlyCommandData));
          await interaction.reply({
            content: `⚙️ DJ Only mode: ${djOnlyEnabled ? '🔒 **Enabled**' : '🔓 **Disabled**'}`,
            flags: MessageFlags.Ephemeral
          });
          break;

        case 'voteskip-enabled':
          const voteSkipEnabled = interaction.options.getBoolean('enabled', true);
          const voteSkipEnabledCommandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'voteSkipEnabled',
            value: voteSkipEnabled,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(voteSkipEnabledCommandData));
          await interaction.reply({
            content: `⚙️ Vote skip: ${voteSkipEnabled ? '✅ **Enabled**' : '❌ **Disabled**'}`,
            flags: MessageFlags.Ephemeral
          });
          break;

        case 'voteskip-threshold':
          const threshold = interaction.options.getNumber('threshold', true);
          // Convert percentage (1-100) to decimal (0.01-1.0)
          const thresholdDecimal = threshold / 100;

          const voteSkipThresholdCommandData = {
            type: 'SET_GUILD_SETTING',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            setting: 'voteSkipThreshold',
            value: thresholdDecimal,
            timestamp: Date.now()
          };
          await this.eventBus.publish('discord-bot:commands', JSON.stringify(voteSkipThresholdCommandData));
          await interaction.reply({
            content: `⚙️ Vote skip threshold set to **${threshold}%** (${Math.ceil(2 * thresholdDecimal)} votes needed for 2 users)`,
            flags: MessageFlags.Ephemeral
          });
          break;

        case 'autoplay':
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

        default:
          await interaction.reply({ content: '❌ Unknown settings subcommand.', flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
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
    } catch (error) {
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