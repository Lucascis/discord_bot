import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { logger } from '@discord-bot/logger';

/**
 * Enhanced Discord API Error Handler
 * Provides robust error classification and handling for Discord API interactions
 */
export class DiscordErrorHandler {

  /**
   * Classify Discord API errors into actionable categories
   */
  static classifyError(error: unknown): {
    type: 'retryable' | 'non_retryable' | 'rate_limit' | 'permission' | 'unknown';
    code: string;
    shouldRetry: boolean;
    retryAfter?: number;
    fallbackStrategy: string;
  } {
    if (!(error instanceof DiscordAPIError)) {
      return {
        type: 'unknown',
        code: 'UNKNOWN_ERROR',
        shouldRetry: false,
        fallbackStrategy: 'fail_gracefully'
      };
    }

    const { code } = error;

    // Non-retryable errors that require fallback strategies
    const nonRetryableErrors = new Map<string | number, string>([
      [RESTJSONErrorCodes.UnknownMessage, 'create_new'], // 10008 - Message was deleted
      [RESTJSONErrorCodes.UnknownChannel, 'ignore'], // 10003 - Channel doesn't exist
      [RESTJSONErrorCodes.UnknownGuild, 'ignore'], // 10004 - Guild doesn't exist
      [RESTJSONErrorCodes.UnknownUser, 'ignore'], // 10013 - User doesn't exist
      [RESTJSONErrorCodes.UnknownInteraction, 'ignore'], // 10062 - Interaction expired
      [50035, 'fail_gracefully'], // 50035 - Invalid form body
      [RESTJSONErrorCodes.CannotSendMessagesToThisUser, 'ignore'], // 50007 - Cannot DM user
      [RESTJSONErrorCodes.MissingPermissions, 'fail_gracefully'], // 50013 - Missing permissions
      [50083, 'create_new'], // 50083 - Message too old
    ]);

    // Rate limit errors
    if (code === 20028 || code === 429) { // Rate limited
      const retryAfter = this.extractRetryAfter(error);
      return {
        type: 'rate_limit',
        code: String(code),
        shouldRetry: true,
        retryAfter,
        fallbackStrategy: 'defer'
      };
    }

    // Permission errors
    if (code === RESTJSONErrorCodes.MissingPermissions ||
        code === RESTJSONErrorCodes.MissingAccess) {
      return {
        type: 'permission',
        code: String(code),
        shouldRetry: false,
        fallbackStrategy: 'fail_gracefully'
      };
    }

    // Check non-retryable errors
    if (nonRetryableErrors.has(code)) {
      return {
        type: 'non_retryable',
        code: String(code),
        shouldRetry: false,
        fallbackStrategy: nonRetryableErrors.get(code)!
      };
    }

    // Retryable errors (connection issues, server errors)
    const retryableCodes: (string | number)[] = [
      0, // 0 - Internal server error
      502, 503, 504, // Gateway errors
    ];

    if (retryableCodes.includes(code) || (typeof code === 'number' && code >= 500 && code < 600)) {
      return {
        type: 'retryable',
        code: String(code),
        shouldRetry: true,
        fallbackStrategy: 'defer'
      };
    }

    // Default classification
    return {
      type: 'unknown',
      code: String(code),
      shouldRetry: false,
      fallbackStrategy: 'fail_gracefully'
    };
  }

  /**
   * Execute a Discord interaction with robust error handling and fallback strategies
   */
  static async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackStrategies: {
      createNew?: () => Promise<T>;
      defer?: () => Promise<T>;
      ignore?: () => Promise<T>;
      failGracefully?: () => Promise<T>;
    },
    context: {
      operationName: string;
      interactionId?: string;
      guildId?: string;
      userId?: string;
    },
    maxRetries: number = 3
  ): Promise<T | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const classification = this.classifyError(error);

        logger.warn({
          ...context,
          attempt,
          maxRetries,
          errorType: classification.type,
          errorCode: classification.code,
          shouldRetry: classification.shouldRetry,
          fallbackStrategy: classification.fallbackStrategy,
          error: error instanceof Error ? error.message : String(error)
        }, `Discord API operation failed - ${context.operationName}`);

        // Handle rate limits
        if (classification.type === 'rate_limit' && classification.retryAfter) {
          if (attempt < maxRetries) {
            await this.delay(classification.retryAfter * 1000);
            continue;
          }
        }

        // Handle retryable errors with exponential backoff
        if (classification.shouldRetry && attempt < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.delay(backoffDelay);
          continue;
        }

        // Execute fallback strategy for non-retryable errors or final attempt
        try {
          switch (classification.fallbackStrategy) {
            case 'create_new':
              if (fallbackStrategies.createNew) {
                logger.info({
                  ...context,
                  fallbackStrategy: 'create_new'
                }, 'Executing create_new fallback strategy');
                return await fallbackStrategies.createNew();
              }
              break;

            case 'defer':
              if (fallbackStrategies.defer) {
                logger.info({
                  ...context,
                  fallbackStrategy: 'defer'
                }, 'Executing defer fallback strategy');
                return await fallbackStrategies.defer();
              }
              break;

            case 'ignore':
              if (fallbackStrategies.ignore) {
                logger.info({
                  ...context,
                  fallbackStrategy: 'ignore'
                }, 'Executing ignore fallback strategy');
                return await fallbackStrategies.ignore();
              }
              // Ignoring error by returning null
              return null;

            case 'fail_gracefully':
              if (fallbackStrategies.failGracefully) {
                logger.info({
                  ...context,
                  fallbackStrategy: 'fail_gracefully'
                }, 'Executing fail_gracefully fallback strategy');
                return await fallbackStrategies.failGracefully();
              }
              break;
          }
        } catch (fallbackError) {
          logger.error({
            ...context,
            fallbackStrategy: classification.fallbackStrategy,
            fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }, 'Fallback strategy failed');
        }

        // If we reach here and it's the final attempt, or no fallback worked
        break;
      }
    }

    // Log final failure
    logger.error({
      ...context,
      attempts: maxRetries,
      finalError: lastError instanceof Error ? lastError.message : String(lastError)
    }, `All attempts failed for Discord operation: ${context.operationName}`);

    return null;
  }

  /**
   * Enhanced message update with automatic fallback to new message creation
   */
  static async updateMessage(
    updateOperation: () => Promise<any>,
    createNewOperation: () => Promise<any>,
    context: {
      operationName: string;
      interactionId?: string;
      guildId?: string;
      messageId?: string;
    }
  ): Promise<any> {
    return this.executeWithFallback(
      updateOperation,
      {
        createNew: createNewOperation,
        failGracefully: async () => {
          logger.warn(context, 'Message update failed, cannot create fallback');
          return null;
        }
      },
      context
    );
  }

  /**
   * Enhanced interaction reply with comprehensive error handling
   */
  static async replyToInteraction(
    interaction: any,
    replyData: any,
    context: {
      operationName: string;
      interactionId?: string;
      guildId?: string;
    }
  ): Promise<any> {
    // CRITICAL: Log all Discord API calls to expose silent failures
    logger.info({
      ...context,
      interactionState: {
        replied: interaction.replied,
        deferred: interaction.deferred,
        type: interaction.type,
        commandName: interaction.commandName || 'unknown'
      },
      replyDataStructure: {
        hasContent: !!replyData.content,
        hasEmbeds: !!replyData.embeds,
        hasComponents: !!replyData.components,
        isEphemeral: !!replyData.flags || !!replyData.ephemeral
      }
    }, 'DISCORD_API_CALL: Attempting interaction reply');

    const result = await this.executeWithFallback(
      async () => {
        logger.info({ ...context }, 'DISCORD_API_CALL: Executing primary operation');
        let response;
        if (interaction.replied || interaction.deferred) {
          logger.info({ ...context }, 'DISCORD_API_CALL: Using editReply (interaction already processed)');
          response = await interaction.editReply(replyData);
        } else {
          logger.info({ ...context }, 'DISCORD_API_CALL: Using reply (fresh interaction)');
          response = await interaction.reply(replyData);
        }
        logger.info({
          ...context,
          responseId: response?.id || 'unknown',
          success: true
        }, 'DISCORD_API_CALL: Primary operation succeeded');
        return response;
      },
      {
        createNew: async () => {
          logger.warn({ ...context }, 'DISCORD_API_CALL: Executing fallback - followUp');
          // Try to send as follow-up if editing fails
          const response = await interaction.followUp(replyData);
          logger.info({
            ...context,
            responseId: response?.id || 'unknown',
            fallback: 'followUp'
          }, 'DISCORD_API_CALL: Fallback followUp succeeded');
          return response;
        },
        defer: async () => {
          logger.warn({ ...context }, 'DISCORD_API_CALL: Executing fallback - defer');
          // Try to defer first if not already done
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
            const response = await interaction.editReply(replyData);
            logger.info({
              ...context,
              responseId: response?.id || 'unknown',
              fallback: 'defer'
            }, 'DISCORD_API_CALL: Fallback defer succeeded');
            return response;
          }
          throw new Error('Cannot defer - interaction already processed');
        },
        failGracefully: async () => {
          logger.error({ ...context }, 'DISCORD_API_CALL: All interaction attempts failed - returning null');
          return null;
        }
      },
      context
    );

    // CRITICAL: Log the final result
    if (result === null) {
      logger.error({
        ...context,
        interactionFinalState: {
          replied: interaction.replied,
          deferred: interaction.deferred
        }
      }, 'DISCORD_API_CALL: SILENT FAILURE DETECTED - No Discord response sent');
    } else {
      logger.info({
        ...context,
        resultId: result?.id || 'unknown',
        success: true
      }, 'DISCORD_API_CALL: Successfully sent Discord response');
    }

    return result;
  }

  private static extractRetryAfter(error: DiscordAPIError): number {
    try {
      // Discord API error might include retry-after in headers or response
      const retryAfter = (error as any).headers?.['retry-after'] ||
                        (error as any).headers?.['Retry-After'] ||
                        1; // Default 1 second
      return typeof retryAfter === 'string' ? parseFloat(retryAfter) : retryAfter;
    } catch {
      return 1; // Default fallback
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error indicates the interaction/message is no longer valid
   */
  static isStaleInteractionError(error: unknown): boolean {
    if (!(error instanceof DiscordAPIError)) return false;

    const staleCodes: (string | number)[] = [
      RESTJSONErrorCodes.UnknownMessage,
      RESTJSONErrorCodes.UnknownInteraction,
      RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged,
      50083 // MessageCannotBeEditedDueToAgeLimit
    ];

    return staleCodes.includes(error.code);
  }
}