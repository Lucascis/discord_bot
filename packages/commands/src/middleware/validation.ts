import { type ChatInputCommandInteraction } from 'discord.js';
import { logger } from '@discord-bot/logger';
import { type CommandContext, type BaseCommand } from '../base/command.js';

export interface ValidationResult {
  success: boolean;
  error?: string;
}

export interface ValidationMiddleware {
  validate(context: CommandContext, command: BaseCommand): Promise<ValidationResult>;
}

/**
 * Rate limiting validation middleware
 */
export class RateLimitMiddleware implements ValidationMiddleware {
  private rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  async validate(context: CommandContext, command: BaseCommand): Promise<ValidationResult> {
    const { rateLimit } = command.metadata;
    if (!rateLimit) return { success: true };

    const key = `${context.guildId}:${context.userId}:${command.metadata.name}`;
    const now = Date.now();
    
    const existing = this.rateLimitMap.get(key);
    
    if (!existing || now > existing.resetTime) {
      this.rateLimitMap.set(key, {
        count: 1,
        resetTime: now + (rateLimit.windowSeconds * 1000),
      });
      return { success: true };
    }

    if (existing.count >= rateLimit.limit) {
      logger.warn({
        command: command.metadata.name,
        guildId: context.guildId,
        userId: context.userId,
        count: existing.count,
        limit: rateLimit.limit,
      }, 'Rate limit exceeded');

      return {
        success: false,
        error: 'You are using this command too frequently. Please wait before trying again.',
      };
    }

    existing.count++;
    return { success: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.rateLimitMap.entries()) {
      if (now > value.resetTime) {
        this.rateLimitMap.delete(key);
      }
    }
  }
}

/**
 * Permission validation middleware
 */
export class PermissionMiddleware implements ValidationMiddleware {
  constructor(
    private hasDjOrAdmin: (interaction: ChatInputCommandInteraction) => boolean
  ) {}

  async validate(context: CommandContext, command: BaseCommand): Promise<ValidationResult> {
    const { permissions } = command.metadata;
    if (!permissions) return { success: true };

    const { interaction } = context;

    if (permissions.requiresDjRole || permissions.requiresAdmin) {
      if (!this.hasDjOrAdmin(interaction)) {
        return {
          success: false,
          error: 'You need the DJ role or Administrator permission to use this command.',
        };
      }
    }

    if (permissions.requiresVoiceChannel) {
      const member = interaction.guild?.members.cache.get(context.userId);
      if (!member?.voice?.channel) {
        return {
          success: false,
          error: 'You must be in a voice channel to use this command.',
        };
      }
    }

    if (permissions.guildOnly && !interaction.guild) {
      return {
        success: false,
        error: 'This command can only be used in a server.',
      };
    }

    return { success: true };
  }
}

/**
 * Command enabled/disabled validation middleware
 */
export class EnabledMiddleware implements ValidationMiddleware {
  async validate(context: CommandContext, command: BaseCommand): Promise<ValidationResult> {
    if (command.metadata.enabled === false) {
      logger.info({
        command: command.metadata.name,
        guildId: context.guildId,
        userId: context.userId,
      }, 'Attempted to use disabled command');

      return {
        success: false,
        error: 'This command is currently disabled.',
      };
    }

    return { success: true };
  }
}

/**
 * Composite middleware that runs multiple validations
 */
export class MiddlewareChain {
  private middlewares: ValidationMiddleware[] = [];

  add(middleware: ValidationMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  async validate(context: CommandContext, command: BaseCommand): Promise<ValidationResult> {
    for (const middleware of this.middlewares) {
      const result = await middleware.validate(context, command);
      if (!result.success) {
        return result;
      }
    }

    return { success: true };
  }
}