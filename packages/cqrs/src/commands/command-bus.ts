import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';

/**
 * Base Command Interface
 * All commands must extend this interface
 */
export interface ICommand {
  readonly commandId: string;
  readonly commandType: string;
  readonly timestamp: Date;
  readonly metadata: CommandMetadata;
}

/**
 * Command Metadata
 * Additional context about the command
 */
export interface CommandMetadata {
  userId?: string;
  guildId?: string;
  correlationId?: string;
  source: string;
  version: string;
  context?: Record<string, unknown>;
}

/**
 * Command Handler Interface
 * Defines contract for command handlers
 */
export interface ICommandHandler<TCommand extends ICommand = ICommand, TResult = any> {
  readonly commandType: string;
  handle(command: TCommand): Promise<TResult>;
}

/**
 * Command Execution Result
 */
export interface CommandResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  events?: any[];
  metadata?: Record<string, unknown>;
}

/**
 * Command Bus Interface
 * Responsible for routing commands to their handlers
 */
export interface ICommandBus {
  registerHandler<TCommand extends ICommand, TResult>(
    handler: ICommandHandler<TCommand, TResult>
  ): void;

  send<TCommand extends ICommand, TResult>(
    command: TCommand
  ): Promise<CommandResult<TResult>>;

  sendBatch<TCommand extends ICommand>(
    commands: TCommand[]
  ): Promise<CommandResult[]>;
}

/**
 * Command Bus Implementation
 * In-memory command bus with handler registration
 */
export class CommandBus implements ICommandBus {
  private readonly handlers = new Map<string, ICommandHandler>();

  registerHandler<TCommand extends ICommand, TResult>(
    handler: ICommandHandler<TCommand, TResult>
  ): void {
    if (this.handlers.has(handler.commandType)) {
      throw new Error(`Handler for command type '${handler.commandType}' is already registered`);
    }

    this.handlers.set(handler.commandType, handler);
    logger.info('Command handler registered', {
      commandType: handler.commandType,
      handlerName: handler.constructor.name
    });
  }

  async send<TCommand extends ICommand, TResult>(
    command: TCommand
  ): Promise<CommandResult<TResult>> {
    const startTime = Date.now();

    try {
      const handler = this.handlers.get(command.commandType);
      if (!handler) {
        const error = `No handler registered for command type: ${command.commandType}`;
        logger.error('Command handler not found', {
          commandType: command.commandType,
          commandId: command.commandId
        });

        return {
          success: false,
          error
        };
      }

      logger.debug('Executing command', {
        commandType: command.commandType,
        commandId: command.commandId,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      });

      const result = await handler.handle(command as any);

      const executionTime = Date.now() - startTime;
      logger.info('Command executed successfully', {
        commandType: command.commandType,
        commandId: command.commandId,
        executionTimeMs: executionTime,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      });

      return {
        success: true,
        data: result,
        metadata: {
          executionTimeMs: executionTime,
          handlerName: handler.constructor.name
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Command execution failed', {
        commandType: command.commandType,
        commandId: command.commandId,
        error: errorMessage,
        executionTimeMs: executionTime,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          executionTimeMs: executionTime
        }
      };
    }
  }

  async sendBatch<TCommand extends ICommand>(
    commands: TCommand[]
  ): Promise<CommandResult[]> {
    if (commands.length === 0) {
      return [];
    }

    logger.info('Executing command batch', {
      batchSize: commands.length,
      commandTypes: [...new Set(commands.map(c => c.commandType))]
    });

    const results = await Promise.allSettled(
      commands.map(command => this.send(command))
    );

    return results.map(result =>
      result.status === 'fulfilled'
        ? result.value
        : {
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          }
    );
  }

  /**
   * Get registered command types
   */
  getRegisteredCommandTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if handler is registered for command type
   */
  hasHandler(commandType: string): boolean {
    return this.handlers.has(commandType);
  }
}

/**
 * Base Command Class
 * Provides common command functionality
 */
export abstract class BaseCommand implements ICommand {
  public readonly commandId: string;
  public readonly timestamp: Date;
  public readonly metadata: CommandMetadata;

  constructor(
    public readonly commandType: string,
    metadata: Partial<CommandMetadata> = {}
  ) {
    this.commandId = uuidv4();
    this.timestamp = new Date();
    this.metadata = {
      source: 'gateway-service',
      version: '1.0',
      ...metadata
    };
  }
}

/**
 * Command Validation Error
 */
export class CommandValidationError extends Error {
  constructor(
    public readonly commandType: string,
    public readonly validationErrors: string[]
  ) {
    super(`Command validation failed: ${validationErrors.join(', ')}`);
    this.name = 'CommandValidationError';
  }
}