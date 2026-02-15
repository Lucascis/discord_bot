import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';

const serializeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : error;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ICommandHandler<TCommand extends ICommand = ICommand, TResult = any> {
  readonly commandType: string;
  handle(command: TCommand): Promise<TResult>;
}

/**
 * Command Execution Result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CommandResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    logger.info({
      commandType: handler.commandType,
      handlerName: handler.constructor.name
    }, 'Command handler registered');
  }

  async send<TCommand extends ICommand, TResult>(
    command: TCommand
  ): Promise<CommandResult<TResult>> {
    const startTime = Date.now();

    try {
      const handler = this.handlers.get(command.commandType);
      if (!handler) {
        const error = `No handler registered for command type: ${command.commandType}`;
        logger.error({
          commandType: command.commandType,
          commandId: command.commandId
        }, 'Command handler not found');

        return {
          success: false,
          error
        };
      }

      logger.debug({
        commandType: command.commandType,
        commandId: command.commandId,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      }, 'Executing command');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handler.handle(command as any);

      const executionTime = Date.now() - startTime;
      logger.info({
        commandType: command.commandType,
        commandId: command.commandId,
        executionTimeMs: executionTime,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      }, 'Command executed successfully');

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

      logger.error({
        commandType: command.commandType,
        commandId: command.commandId,
        error: serializeError(error),
        executionTimeMs: executionTime,
        userId: command.metadata.userId,
        guildId: command.metadata.guildId
      }, 'Command execution failed');

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

    logger.info({
      batchSize: commands.length,
      commandTypes: [...new Set(commands.map(c => c.commandType))]
    }, 'Executing command batch');

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
