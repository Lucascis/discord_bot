import { type CommandContext, type BaseCommand, type CommandExecutionResult } from '../base/command.js';
import { logger } from '@discord-bot/logger';

export interface LoggingOptions {
  logStart?: boolean;
  logEnd?: boolean;
  logErrors?: boolean;
  logPerformance?: boolean;
  sensitiveCommands?: string[];
}

export class LoggingMiddleware {
  private options: Required<LoggingOptions>;

  constructor(options: LoggingOptions = {}) {
    this.options = {
      logStart: true,
      logEnd: true,
      logErrors: true,
      logPerformance: true,
      sensitiveCommands: [],
      ...options,
    };
  }

  private isSensitive(commandName: string): boolean {
    return this.options.sensitiveCommands.includes(commandName);
  }

  logCommandStart(context: CommandContext, command: BaseCommand): void {
    if (!this.options.logStart) return;

    const logData = {
      command: command.metadata.name,
      category: command.metadata.category,
      guildId: context.guildId,
      userId: context.userId,
      channelId: context.channelId,
      timestamp: new Date().toISOString(),
    };

    if (this.isSensitive(command.metadata.name)) {
      logger.info(logData, 'Command execution started [SENSITIVE]');
    } else {
      const options = context.interaction.options.data.map(option => ({
        name: option.name,
        type: option.type,
        value: option.value,
      }));

      logger.info({
        ...logData,
        options,
      }, 'Command execution started');
    }
  }

  logCommandEnd(
    context: CommandContext, 
    command: BaseCommand, 
    result: CommandExecutionResult,
    executionTime: number
  ): void {
    if (!this.options.logEnd) return;

    const logData = {
      command: command.metadata.name,
      category: command.metadata.category,
      guildId: context.guildId,
      userId: context.userId,
      success: result.success,
      timestamp: new Date().toISOString(),
    };

    if (this.options.logPerformance) {
      Object.assign(logData, { executionTimeMs: executionTime });
    }

    if (result.success) {
      logger.info(logData, 'Command execution completed');
    } else {
      logger.warn({
        ...logData,
        error: result.error,
      }, 'Command execution failed');
    }
  }

  logCommandError(
    context: CommandContext, 
    command: BaseCommand, 
    error: Error,
    executionTime: number
  ): void {
    if (!this.options.logErrors) return;

    const logData = {
      command: command.metadata.name,
      category: command.metadata.category,
      guildId: context.guildId,
      userId: context.userId,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      executionTimeMs: executionTime,
      timestamp: new Date().toISOString(),
    };

    logger.error(logData, 'Command execution error');
  }

  logPerformanceMetrics(commandName: string, metrics: {
    executionTime: number;
    memoryUsed: number;
    cpuUsage?: number;
  }): void {
    if (!this.options.logPerformance) return;

    logger.info({
      command: commandName,
      metrics,
      timestamp: new Date().toISOString(),
    }, 'Command performance metrics');
  }
}

/**
 * Performance monitoring decorator
 */
// Removed Monitor decorator to avoid TS strict this-typing and unused-parameter issues.
