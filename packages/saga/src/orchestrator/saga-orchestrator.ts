import { v4 as uuidv4 } from 'uuid';
import { logger } from '@discord-bot/logger';
import type { DomainEvent } from '@discord-bot/event-store';
import type { ICommandBus, ICommand } from '@discord-bot/cqrs';

import {
  SagaInstance,
  SagaDefinition,
  SagaExecutionContext,
  SagaState
} from '../domain/saga.js';

/**
 * Saga Repository Interface
 * For persisting saga state
 */
export interface ISagaRepository {
  save(context: SagaExecutionContext): Promise<void>;
  load(sagaId: string): Promise<SagaExecutionContext | null>;
  findByCorrelationId(correlationId: string): Promise<SagaExecutionContext[]>;
  findByState(state: SagaState): Promise<SagaExecutionContext[]>;
  findTimedOut(): Promise<SagaExecutionContext[]>;
  delete(sagaId: string): Promise<void>;
}

/**
 * Saga Event Handler
 * For handling events that trigger saga steps
 */
export interface ISagaEventHandler {
  canHandle(event: DomainEvent): boolean;
  handle(event: DomainEvent, orchestrator: SagaOrchestrator): Promise<void>;
}

/**
 * Saga Orchestrator
 * Manages saga lifecycle and execution
 */
export class SagaOrchestrator {
  private readonly commandBus: ICommandBus;
  private readonly sagaRepository: ISagaRepository;
  private readonly definitions = new Map<string, SagaDefinition>();
  private readonly eventHandlers: ISagaEventHandler[] = [];
  private readonly activeTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    commandBus: ICommandBus,
    sagaRepository: ISagaRepository
  ) {
    this.commandBus = commandBus;
    this.sagaRepository = sagaRepository;
  }

  /**
   * Register a saga definition
   */
  registerSagaDefinition(definition: SagaDefinition): void {
    if (this.definitions.has(definition.sagaType)) {
      throw new Error(`Saga definition for type '${definition.sagaType}' already registered`);
    }

    this.definitions.set(definition.sagaType, definition);
    logger.info('Saga definition registered', {
      sagaType: definition.sagaType,
      stepCount: definition.steps.length
    });
  }

  /**
   * Register an event handler
   */
  registerEventHandler(handler: ISagaEventHandler): void {
    this.eventHandlers.push(handler);
    logger.info('Saga event handler registered', {
      handlerName: handler.constructor.name
    });
  }

  /**
   * Start a new saga
   */
  async startSaga(
    sagaType: string,
    initialData: Record<string, unknown> = {},
    correlationId?: string
  ): Promise<string> {
    const definition = this.definitions.get(sagaType);
    if (!definition) {
      throw new Error(`No saga definition found for type: ${sagaType}`);
    }

    const saga = new SagaInstance(definition, undefined, correlationId);
    saga.start(initialData);

    await this.sagaRepository.save(saga.context);

    logger.info('Saga started', {
      sagaId: saga.sagaId,
      sagaType,
      correlationId: saga.context.correlationId,
      stepCount: definition.steps.length
    });

    // Start executing the first step
    await this.executeNextStep(saga);

    return saga.sagaId;
  }

  /**
   * Handle an event that might trigger saga actions
   */
  async handleEvent(event: DomainEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      if (handler.canHandle(event)) {
        try {
          await handler.handle(event, this);
        } catch (error) {
          logger.error('Error handling event in saga orchestrator', {
            eventType: event.eventType,
            eventId: event.eventId,
            handlerName: handler.constructor.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  /**
   * Complete a saga step
   */
  async completeStep(
    sagaId: string,
    stepResult?: Record<string, unknown>
  ): Promise<void> {
    const context = await this.sagaRepository.load(sagaId);
    if (!context) {
      logger.warn('Saga not found for step completion', { sagaId });
      return;
    }

    const definition = this.definitions.get(context.sagaType);
    if (!definition) {
      logger.error('Saga definition not found', {
        sagaId,
        sagaType: context.sagaType
      });
      return;
    }

    const saga = SagaInstance.fromContext(definition, context);

    try {
      saga.completeCurrentStep(stepResult);
      await this.sagaRepository.save(saga.context);

      logger.info('Saga step completed', {
        sagaId,
        stepIndex: saga.context.currentStepIndex - 1,
        totalSteps: definition.steps.length,
        sagaState: saga.state
      });

      if (saga.isCompleted) {
        await this.completeSaga(saga);
      } else if (saga.hasMoreSteps) {
        await this.executeNextStep(saga);
      }

    } catch (error) {
      logger.error('Error completing saga step', {
        sagaId,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.failStep(sagaId, error as Error);
    }
  }

  /**
   * Fail a saga step
   */
  async failStep(sagaId: string, error: Error): Promise<void> {
    const context = await this.sagaRepository.load(sagaId);
    if (!context) {
      logger.warn('Saga not found for step failure', { sagaId });
      return;
    }

    const definition = this.definitions.get(context.sagaType);
    if (!definition) {
      logger.error('Saga definition not found', {
        sagaId,
        sagaType: context.sagaType
      });
      return;
    }

    const saga = SagaInstance.fromContext(definition, context);

    try {
      saga.failCurrentStep(error);
      await this.sagaRepository.save(saga.context);

      logger.warn('Saga step failed', {
        sagaId,
        stepIndex: saga.context.currentStepIndex,
        retryCount: saga.context.retryCount,
        error: error.message
      });

      if (saga.shouldRetryCurrentStep()) {
        // Schedule retry
        const retryDelay = saga.getRetryDelay();
        setTimeout(async () => {
          await this.retryCurrentStep(sagaId);
        }, retryDelay);

        logger.info('Saga step retry scheduled', {
          sagaId,
          retryDelay,
          retryCount: saga.context.retryCount
        });
      } else {
        // Start compensation
        await this.startCompensation(saga);
      }

    } catch (compensationError) {
      logger.error('Error handling saga step failure', {
        sagaId,
        originalError: error.message,
        compensationError: compensationError instanceof Error
          ? compensationError.message
          : String(compensationError)
      });

      saga.markAsFailed(compensationError as Error);
      await this.sagaRepository.save(saga.context);
    }
  }

  /**
   * Cancel a saga
   */
  async cancelSaga(sagaId: string): Promise<void> {
    const context = await this.sagaRepository.load(sagaId);
    if (!context) {
      logger.warn('Saga not found for cancellation', { sagaId });
      return;
    }

    const definition = this.definitions.get(context.sagaType);
    if (!definition) {
      logger.error('Saga definition not found', {
        sagaId,
        sagaType: context.sagaType
      });
      return;
    }

    const saga = SagaInstance.fromContext(definition, context);

    try {
      saga.cancel();
      await this.sagaRepository.save(saga.context);

      // Clear any pending timers
      const timer = this.activeTimers.get(sagaId);
      if (timer) {
        clearTimeout(timer);
        this.activeTimers.delete(sagaId);
      }

      logger.info('Saga cancelled', {
        sagaId,
        sagaType: context.sagaType
      });

      // Start compensation if there are completed steps
      if (saga.context.completedSteps.length > 0) {
        await this.startCompensation(saga);
      }

    } catch (error) {
      logger.error('Error cancelling saga', {
        sagaId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process timed out sagas
   */
  async processTimedOutSagas(): Promise<void> {
    try {
      const timedOutContexts = await this.sagaRepository.findTimedOut();

      for (const context of timedOutContexts) {
        logger.warn('Processing timed out saga', {
          sagaId: context.sagaId,
          sagaType: context.sagaType,
          timeoutAt: context.timeoutAt
        });

        await this.cancelSaga(context.sagaId);
      }

    } catch (error) {
      logger.error('Error processing timed out sagas', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Execute the next step in a saga
   */
  private async executeNextStep(saga: SagaInstance): Promise<void> {
    if (!saga.hasMoreSteps) {
      return;
    }

    const currentStep = saga.currentStep!;

    try {
      // Set timeout for step if specified
      if (currentStep.timeout) {
        const timer = setTimeout(async () => {
          await this.failStep(
            saga.sagaId,
            new Error(`Step '${currentStep.stepName}' timed out after ${currentStep.timeout}ms`)
          );
        }, currentStep.timeout);

        this.activeTimers.set(`${saga.sagaId}-${currentStep.stepId}`, timer);
      }

      logger.debug('Executing saga step', {
        sagaId: saga.sagaId,
        stepId: currentStep.stepId,
        stepName: currentStep.stepName,
        commandType: currentStep.command.commandType
      });

      // Execute the command
      const result = await this.commandBus.send(currentStep.command);

      // Clear step timer
      const timer = this.activeTimers.get(`${saga.sagaId}-${currentStep.stepId}`);
      if (timer) {
        clearTimeout(timer);
        this.activeTimers.delete(`${saga.sagaId}-${currentStep.stepId}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'Command execution failed');
      }

      // Note: Step completion will be handled by event handlers or explicit calls
      // This allows for asynchronous operations to complete before moving to next step

    } catch (error) {
      await this.failStep(saga.sagaId, error as Error);
    }
  }

  /**
   * Retry the current step
   */
  private async retryCurrentStep(sagaId: string): Promise<void> {
    const context = await this.sagaRepository.load(sagaId);
    if (!context) {
      return;
    }

    const definition = this.definitions.get(context.sagaType);
    if (!definition) {
      return;
    }

    const saga = SagaInstance.fromContext(definition, context);
    await this.executeNextStep(saga);
  }

  /**
   * Start compensation process
   */
  private async startCompensation(saga: SagaInstance): Promise<void> {
    saga.startCompensation();
    await this.sagaRepository.save(saga.context);

    logger.info('Starting saga compensation', {
      sagaId: saga.sagaId,
      completedSteps: saga.context.completedSteps.length
    });

    await this.executeCompensationStep(saga);
  }

  /**
   * Execute compensation step
   */
  private async executeCompensationStep(saga: SagaInstance): Promise<void> {
    if (saga.context.currentStepIndex < 0) {
      // All compensations completed
      await this.completeSagaCompensation(saga);
      return;
    }

    const stepIndex = saga.context.currentStepIndex;
    const step = saga.definition.steps[stepIndex];

    if (!step.compensationCommand) {
      // No compensation command, mark as compensated
      saga.completeCurrentCompensation();
      await this.sagaRepository.save(saga.context);
      await this.executeCompensationStep(saga);
      return;
    }

    try {
      logger.debug('Executing saga compensation step', {
        sagaId: saga.sagaId,
        stepId: step.stepId,
        stepName: step.stepName,
        commandType: step.compensationCommand.commandType
      });

      const result = await this.commandBus.send(step.compensationCommand);

      if (!result.success) {
        throw new Error(result.error || 'Compensation command execution failed');
      }

      saga.completeCurrentCompensation();
      await this.sagaRepository.save(saga.context);

      // Continue with next compensation
      await this.executeCompensationStep(saga);

    } catch (error) {
      logger.error('Compensation step failed', {
        sagaId: saga.sagaId,
        stepId: step.stepId,
        error: error instanceof Error ? error.message : String(error)
      });

      saga.markAsFailed(error as Error);
      await this.sagaRepository.save(saga.context);
    }
  }

  /**
   * Complete saga successfully
   */
  private async completeSaga(saga: SagaInstance): Promise<void> {
    logger.info('Saga completed successfully', {
      sagaId: saga.sagaId,
      sagaType: saga.context.sagaType,
      totalSteps: saga.definition.steps.length,
      duration: Date.now() - saga.context.startedAt.getTime()
    });

    if (saga.definition.onCompleted) {
      try {
        await saga.definition.onCompleted(saga.context);
      } catch (error) {
        logger.error('Error in saga completion callback', {
          sagaId: saga.sagaId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Clean up saga after successful completion
    await this.sagaRepository.delete(saga.sagaId);
  }

  /**
   * Complete saga compensation
   */
  private async completeSagaCompensation(saga: SagaInstance): Promise<void> {
    logger.info('Saga compensation completed', {
      sagaId: saga.sagaId,
      sagaType: saga.context.sagaType,
      compensatedSteps: saga.context.compensatedSteps.length
    });

    if (saga.definition.onCompensated) {
      try {
        await saga.definition.onCompensated(saga.context);
      } catch (error) {
        logger.error('Error in saga compensation callback', {
          sagaId: saga.sagaId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Clean up saga after compensation
    await this.sagaRepository.delete(saga.sagaId);
  }
}