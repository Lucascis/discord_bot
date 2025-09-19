import { v4 as uuidv4 } from 'uuid';
import type { ICommand } from '@discord-bot/cqrs';

/**
 * Saga State
 * Represents the current state of a saga instance
 */
export type SagaState =
  | 'pending'     // Saga has been created but not started
  | 'running'     // Saga is currently executing
  | 'completed'   // Saga completed successfully
  | 'failed'      // Saga failed and cannot continue
  | 'compensating'// Saga is running compensation logic
  | 'compensated' // Saga has been fully compensated
  | 'cancelled';  // Saga was cancelled before completion

/**
 * Saga Step
 * Represents a single step in a saga workflow
 */
export interface SagaStep {
  stepId: string;
  stepName: string;
  command: ICommand;
  compensationCommand?: ICommand;
  timeout?: number; // milliseconds
  retryPolicy?: RetryPolicy;
}

/**
 * Retry Policy
 * Defines how failed steps should be retried
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
}

/**
 * Saga Execution Context
 * Contains runtime information about saga execution
 */
export interface SagaExecutionContext {
  sagaId: string;
  sagaType: string;
  correlationId: string;
  state: SagaState;
  currentStepIndex: number;
  completedSteps: string[];
  failedSteps: string[];
  compensatedSteps: string[];
  data: Record<string, unknown>;
  startedAt: Date;
  lastUpdatedAt: Date;
  timeoutAt?: Date;
  errorMessage?: string;
  retryCount: number;
}

/**
 * Saga Definition
 * Defines the workflow and compensation logic for a saga
 */
export interface SagaDefinition {
  sagaType: string;
  steps: SagaStep[];
  globalTimeout?: number; // milliseconds
  onCompleted?: (context: SagaExecutionContext) => Promise<void>;
  onFailed?: (context: SagaExecutionContext, error: Error) => Promise<void>;
  onCompensated?: (context: SagaExecutionContext) => Promise<void>;
}

/**
 * Saga Instance
 * Runtime instance of a saga with execution state
 */
export class SagaInstance {
  private _context: SagaExecutionContext;
  private readonly _definition: SagaDefinition;

  constructor(
    definition: SagaDefinition,
    sagaId?: string,
    correlationId?: string
  ) {
    this._definition = definition;
    this._context = {
      sagaId: sagaId ?? uuidv4(),
      sagaType: definition.sagaType,
      correlationId: correlationId ?? uuidv4(),
      state: 'pending',
      currentStepIndex: 0,
      completedSteps: [],
      failedSteps: [],
      compensatedSteps: [],
      data: {},
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      timeoutAt: definition.globalTimeout
        ? new Date(Date.now() + definition.globalTimeout)
        : undefined,
      retryCount: 0
    };
  }

  get context(): SagaExecutionContext {
    return { ...this._context };
  }

  get definition(): SagaDefinition {
    return this._definition;
  }

  get sagaId(): string {
    return this._context.sagaId;
  }

  get state(): SagaState {
    return this._context.state;
  }

  get isCompleted(): boolean {
    return this._context.state === 'completed';
  }

  get isFailed(): boolean {
    return this._context.state === 'failed';
  }

  get isRunning(): boolean {
    return this._context.state === 'running';
  }

  get isCompensating(): boolean {
    return this._context.state === 'compensating';
  }

  get hasTimedOut(): boolean {
    return this._context.timeoutAt ? new Date() > this._context.timeoutAt : false;
  }

  get currentStep(): SagaStep | undefined {
    return this._definition.steps[this._context.currentStepIndex];
  }

  get nextStep(): SagaStep | undefined {
    return this._definition.steps[this._context.currentStepIndex + 1];
  }

  get hasMoreSteps(): boolean {
    return this._context.currentStepIndex < this._definition.steps.length;
  }

  /**
   * Start the saga execution
   */
  start(initialData: Record<string, unknown> = {}): void {
    if (this._context.state !== 'pending') {
      throw new Error(`Cannot start saga in state: ${this._context.state}`);
    }

    this._context.state = 'running';
    this._context.data = { ...initialData };
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Mark current step as completed and move to next step
   */
  completeCurrentStep(stepResult?: Record<string, unknown>): void {
    const currentStep = this.currentStep;
    if (!currentStep) {
      throw new Error('No current step to complete');
    }

    this._context.completedSteps.push(currentStep.stepId);
    this._context.currentStepIndex++;
    this._context.retryCount = 0; // Reset retry count for next step

    if (stepResult) {
      this._context.data = { ...this._context.data, ...stepResult };
    }

    // Check if saga is completed
    if (!this.hasMoreSteps) {
      this._context.state = 'completed';
    }

    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Mark current step as failed
   */
  failCurrentStep(error: Error): void {
    const currentStep = this.currentStep;
    if (!currentStep) {
      throw new Error('No current step to fail');
    }

    this._context.failedSteps.push(currentStep.stepId);
    this._context.errorMessage = error.message;
    this._context.retryCount++;

    // Check if we should retry
    const retryPolicy = currentStep.retryPolicy;
    if (retryPolicy && this._context.retryCount < retryPolicy.maxAttempts) {
      // Will retry, don't change state
      this._context.lastUpdatedAt = new Date();
      return;
    }

    // No more retries, start compensation
    this._context.state = 'compensating';
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Start compensation process
   */
  startCompensation(): void {
    this._context.state = 'compensating';
    this._context.currentStepIndex = this._context.completedSteps.length - 1;
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Mark current compensation step as completed
   */
  completeCurrentCompensation(): void {
    const stepIndex = this._context.currentStepIndex;
    const step = this._definition.steps[stepIndex];

    if (step) {
      this._context.compensatedSteps.push(step.stepId);
    }

    this._context.currentStepIndex--;

    // Check if all compensations are done
    if (this._context.currentStepIndex < 0) {
      this._context.state = 'compensated';
    }

    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Mark saga as failed (cannot be compensated)
   */
  markAsFailed(error: Error): void {
    this._context.state = 'failed';
    this._context.errorMessage = error.message;
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Cancel the saga
   */
  cancel(): void {
    if (this._context.state === 'completed' || this._context.state === 'failed') {
      throw new Error(`Cannot cancel saga in state: ${this._context.state}`);
    }

    this._context.state = 'cancelled';
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Update saga data
   */
  updateData(data: Record<string, unknown>): void {
    this._context.data = { ...this._context.data, ...data };
    this._context.lastUpdatedAt = new Date();
  }

  /**
   * Get retry delay for current step
   */
  getRetryDelay(): number {
    const currentStep = this.currentStep;
    const retryPolicy = currentStep?.retryPolicy;

    if (!retryPolicy) {
      return 0;
    }

    const delay = Math.min(
      retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, this._context.retryCount - 1),
      retryPolicy.maxBackoffMs
    );

    return delay;
  }

  /**
   * Check if current step should be retried
   */
  shouldRetryCurrentStep(): boolean {
    const currentStep = this.currentStep;
    const retryPolicy = currentStep?.retryPolicy;

    return retryPolicy ? this._context.retryCount < retryPolicy.maxAttempts : false;
  }

  /**
   * Create saga from persisted context
   */
  static fromContext(definition: SagaDefinition, context: SagaExecutionContext): SagaInstance {
    const saga = new SagaInstance(definition, context.sagaId, context.correlationId);
    saga._context = { ...context };
    return saga;
  }
}