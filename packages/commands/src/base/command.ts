import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { logger } from '@discord-bot/logger';

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  guildId: string;
  userId: string;
  channelId: string | null;
}

export interface CommandPermissions {
  requiresDjRole?: boolean;
  requiresAdmin?: boolean;
  requiresVoiceChannel?: boolean;
  guildOnly?: boolean;
}

export interface CommandRateLimit {
  limit: number;
  windowSeconds: number;
}

export interface CommandExecutionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface CommandMetadata {
  name: string;
  description: string;
  category: string;
  permissions?: CommandPermissions;
  rateLimit?: CommandRateLimit;
  enabled?: boolean;
}

export abstract class BaseCommand {
  public readonly metadata: CommandMetadata;
  
  constructor(metadata: CommandMetadata) {
    this.metadata = {
      enabled: true,
      permissions: {
        guildOnly: true,
      },
      rateLimit: {
        limit: 5,
        windowSeconds: 60,
      },
      ...metadata,
    };
  }

  abstract buildSlashCommand(): any;
  
  abstract execute(context: CommandContext): Promise<CommandExecutionResult>;

  async validateContext(context: CommandContext): Promise<boolean> {
    const { interaction } = context;
    const { permissions } = this.metadata;

    if (permissions?.guildOnly && !interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return false;
    }

    if (permissions?.requiresVoiceChannel) {
      const member = interaction.guild?.members.cache.get(context.userId);
      if (!member?.voice?.channel) {
        await interaction.reply({
          content: 'You must be in a voice channel to use this command.',
          ephemeral: true,
        });
        return false;
      }
    }

    return true;
  }

  protected async handleError(
    context: CommandContext,
    error: Error
  ): Promise<void> {
    logger.error({
      error,
      command: this.metadata.name,
      guildId: context.guildId,
      userId: context.userId,
    }, 'Command execution error');

    const errorMessage = 'An error occurred while executing this command.';
    
    try {
      if (context.interaction.deferred) {
        await context.interaction.editReply({ content: errorMessage });
      } else if (!context.interaction.replied) {
        await context.interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      logger.error({ error: replyError }, 'Failed to send error reply');
    }
  }

  protected createContext(interaction: ChatInputCommandInteraction): CommandContext {
    return {
      interaction,
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      channelId: interaction.channelId,
    };
  }

  public async run(interaction: ChatInputCommandInteraction): Promise<void> {
    const context = this.createContext(interaction);
    
    try {
      logger.info({
        command: this.metadata.name,
        guildId: context.guildId,
        userId: context.userId,
      }, 'Command execution started');

      if (!await this.validateContext(context)) {
        return;
      }

      const result = await this.execute(context);
      
      if (!result.success && result.error) {
        logger.warn({
          command: this.metadata.name,
          error: result.error,
          guildId: context.guildId,
        }, 'Command execution failed');
      }

    } catch (error) {
      await this.handleError(context, error as Error);
    }
  }
}
