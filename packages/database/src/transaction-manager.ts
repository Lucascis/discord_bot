import { PrismaClient, Prisma } from '@prisma/client';
import { getLogger } from './logger-interface.js';

export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'TRANSACTION_ERROR',
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface TransactionMetrics {
  transactionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'committed' | 'aborted' | 'failed';
  retryCount: number;
  operations: string[];
}

/**
 * Advanced transaction manager with atomic operations, retry logic, and monitoring
 */
export class TransactionManager {
  private activeTransactions = new Map<string, TransactionMetrics>();
  private transactionCounter = 0;

  constructor(private prisma: PrismaClient) {}

  /**
   * Execute operations within an atomic transaction with retry logic
   */
  async withTransaction<T>(
    operations: (tx: Prisma.TransactionClient) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const {
      maxWait = 5000,
      timeout = 10000,
      isolationLevel = 'ReadCommitted',
      retryAttempts = 3,
      retryDelay = 1000
    } = options;

    const transactionId = `tx_${++this.transactionCounter}_${Date.now()}`;
    const metrics: TransactionMetrics = {
      transactionId,
      startTime: Date.now(),
      status: 'pending',
      retryCount: 0,
      operations: []
    };

    this.activeTransactions.set(transactionId, metrics);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      if (attempt > 0) {
        metrics.retryCount = attempt;
        await this.delay(retryDelay * attempt); // Exponential backoff

        getLogger().warn({
          transactionId,
          attempt,
          maxAttempts: retryAttempts,
          lastError: lastError?.message
        }, 'Retrying transaction');
      }

      try {
        getLogger().info({
          transactionId,
          attempt,
          isolationLevel,
          timeout,
          maxWait
        }, 'Starting transaction');

        const result = await this.prisma.$transaction(
          async (tx) => {
            // Track operations for debugging
            const operationTracker = this.createOperationTracker(metrics);

            // Wrap common operations for tracking
            const wrappedTx = new Proxy(tx, {
              get(target, prop) {
                const original = target[prop as keyof typeof target];
                if (typeof original === 'object' && original !== null) {
                  return new Proxy(original, {
                    get(modelTarget, modelProp) {
                      const modelOriginal = modelTarget[modelProp as keyof typeof modelTarget];
                      if (typeof modelOriginal === 'function') {
                        return function(...args: unknown[]) {
                          operationTracker(`${String(prop)}.${String(modelProp)}`);
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          return (modelOriginal as any).apply(modelTarget, args);
                        };
                      }
                      return modelOriginal;
                    }
                  });
                }
                return original;
              }
            });

            return await operations(wrappedTx);
          },
          {
            maxWait,
            timeout,
            isolationLevel
          }
        );

        metrics.status = 'committed';
        metrics.endTime = Date.now();
        metrics.duration = metrics.endTime - metrics.startTime;

        getLogger().info({
          transactionId,
          duration: metrics.duration,
          retryCount: metrics.retryCount,
          operations: metrics.operations
        }, 'Transaction committed successfully');

        this.activeTransactions.delete(transactionId);
        return result;

      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error as Error);

        getLogger().error({
          transactionId,
          attempt,
          error: lastError.message,
          isRetryable,
          remainingAttempts: retryAttempts - attempt
        }, 'Transaction failed');

        if (!isRetryable || attempt === retryAttempts) {
          metrics.status = 'failed';
          metrics.endTime = Date.now();
          metrics.duration = metrics.endTime - metrics.startTime;

          this.activeTransactions.delete(transactionId);

          throw new TransactionError(
            `Transaction failed after ${attempt + 1} attempts: ${lastError.message}`,
            this.getErrorCode(lastError),
            isRetryable && attempt < retryAttempts
          );
        }
      }
    }

    // This should never be reached
    throw new TransactionError('Transaction exhausted all retry attempts');
  }

  /**
   * Execute multiple independent transactions in parallel with coordination
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async withParallelTransactions<T extends Record<string, any>>(
    transactions: {
      [K in keyof T]: (tx: Prisma.TransactionClient) => Promise<T[K]>;
    },
    options: TransactionOptions = {}
  ): Promise<T> {
    const transactionPromises = Object.entries(transactions).map(
      async ([key, operation]) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await this.withTransaction(operation as any, options);
          return { key, result, error: null };
        } catch (error) {
          return { key, result: null, error: error as Error };
        }
      }
    );

    const results = await Promise.all(transactionPromises);
    const failures = results.filter(r => r.error);

    if (failures.length > 0) {
      getLogger().error({
        totalTransactions: results.length,
        failures: failures.length,
        failedKeys: failures.map(f => f.key),
        errors: failures.map(f => f.error?.message)
      }, 'Some parallel transactions failed');

      throw new TransactionError(
        `${failures.length}/${results.length} parallel transactions failed`,
        'PARALLEL_TRANSACTION_FAILURE'
      );
    }

    const finalResult = {} as T;
    for (const { key, result } of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (finalResult as any)[key] = result;
    }

    return finalResult;
  }

  /**
   * Execute a compensating transaction pattern (saga)
   */
  async withSaga<T>(
    steps: Array<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (tx: Prisma.TransactionClient) => Promise<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compensate: (tx: Prisma.TransactionClient, result?: any) => Promise<void>;
      name: string;
    }>,
    options: TransactionOptions = {}
  ): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completedSteps: Array<{ step: typeof steps[0]; result: any }> = [];

    try {
      // Execute all steps
      for (const step of steps) {
        const result = await this.withTransaction(step.execute, options);
        completedSteps.push({ step, result });

        getLogger().info({
          stepName: step.name,
          completedSteps: completedSteps.length,
          totalSteps: steps.length
        }, 'Saga step completed');
      }

      return completedSteps[completedSteps.length - 1]?.result;

    } catch (error) {
      getLogger().error({
        error: (error as Error).message,
        completedSteps: completedSteps.length,
        totalSteps: steps.length
      }, 'Saga failed, executing compensation');

      // Execute compensation in reverse order
      for (let i = completedSteps.length - 1; i >= 0; i--) {
        const { step, result } = completedSteps[i];
        try {
          await this.withTransaction(
            (tx) => step.compensate(tx, result),
            { ...options, retryAttempts: 1 }
          );

          getLogger().info({
            stepName: step.name,
            compensationStep: i + 1
          }, 'Saga compensation step completed');

        } catch (compensationError) {
          getLogger().error({
            stepName: step.name,
            error: (compensationError as Error).message
          }, 'Saga compensation failed - manual intervention required');
        }
      }

      throw error;
    }
  }

  /**
   * Get metrics for active and recent transactions
   */
  getMetrics(): {
    activeTransactions: number;
    activeTransactionsList: TransactionMetrics[];
  } {
    return {
      activeTransactions: this.activeTransactions.size,
      activeTransactionsList: Array.from(this.activeTransactions.values())
    };
  }

  /**
   * Force abort all active transactions (emergency use only)
   */
  async emergencyAbortAll(): Promise<void> {
    getLogger().warn({
      activeTransactions: this.activeTransactions.size
    }, 'Emergency abort of all active transactions initiated');

    for (const [, metrics] of this.activeTransactions) {
      metrics.status = 'aborted';
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
    }

    this.activeTransactions.clear();

    // Disconnect and reconnect to force abort any hanging transactions
    await this.prisma.$disconnect();
  }

  private createOperationTracker(metrics: TransactionMetrics) {
    return (operation: string) => {
      metrics.operations.push(operation);
      getLogger().info({
        transactionId: metrics.transactionId,
        operation,
        totalOperations: metrics.operations.length
      }, 'Transaction operation tracked');
    };
  }

  private isRetryableError(error: Error): boolean {
    const retryableCodes = [
      'P2034', // Transaction conflict
      'P2024', // Connection timeout
      'P2028', // Transaction API error
      'P2030', // Connection pool timeout
    ];

    const retryableMessages = [
      'connection',
      'timeout',
      'deadlock',
      'serialization',
      'conflict'
    ];

    const errorMessage = error.message.toLowerCase();

    // Check Prisma error codes
    if ('code' in error && typeof error.code === 'string') {
      if (retryableCodes.includes(error.code)) {
        return true;
      }
    }

    // Check error messages
    return retryableMessages.some(keyword => errorMessage.includes(keyword));
  }

  private getErrorCode(error: Error): string {
    if ('code' in error && typeof error.code === 'string') {
      return error.code;
    }

    if (error.message.includes('timeout')) return 'TIMEOUT';
    if (error.message.includes('deadlock')) return 'DEADLOCK';
    if (error.message.includes('conflict')) return 'CONFLICT';

    return 'UNKNOWN';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let transactionManager: TransactionManager | null = null;

export function getTransactionManager(prisma: PrismaClient): TransactionManager {
  if (!transactionManager) {
    transactionManager = new TransactionManager(prisma);
  }
  return transactionManager;
}

// Common transaction patterns using actual schema models
export const TransactionPatterns = {
  /**
   * Queue operations that must be atomic
   */
  async atomicQueueUpdate(
    tx: Prisma.TransactionClient,
    guildId: string,
    operations: {
      add?: Array<{ url: string; title: string; requestedBy: string; duration?: number }>;
      clear?: boolean;
    }
  ) {
    // Find or create queue
    let queue = await tx.queue.findFirst({
      where: { guildId },
      select: { id: true }
    });

    if (!queue) {
      queue = await tx.queue.create({
        data: { guildId },
        select: { id: true }
      });
    }

    if (operations.clear) {
      await tx.queueItem.deleteMany({
        where: { queueId: queue.id }
      });
    }

    if (operations.add?.length) {
      await tx.queueItem.createMany({
        data: operations.add.map((track) => ({
          queueId: queue!.id,
          url: track.url,
          title: track.title,
          requestedBy: track.requestedBy,
          duration: track.duration || 0
        }))
      });
    }

    return queue;
  },

  /**
   * Audit log creation with user profile tracking
   */
  async atomicAuditLog(
    tx: Prisma.TransactionClient,
    guildId: string,
    userId: string,
    action: string
  ) {
    // Ensure user profile exists
    await tx.userProfile.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });

    // Create audit log entry
    return await tx.auditLog.create({
      data: {
        guildId,
        userId,
        action
      }
    });
  },

  /**
   * Feature flag update with audit tracking
   */
  async atomicFeatureFlagUpdate(
    tx: Prisma.TransactionClient,
    guildId: string,
    flagName: string,
    enabled: boolean,
    userId: string
  ) {
    // Update feature flag
    const flag = await tx.featureFlag.upsert({
      where: {
        guildId_name: { guildId, name: flagName }
      },
      create: {
        guildId,
        name: flagName,
        enabled
      },
      update: {
        enabled
      }
    });

    // Create audit log
    await tx.auditLog.create({
      data: {
        guildId,
        userId,
        action: `feature_flag_${enabled ? 'enabled' : 'disabled'}_${flagName}`
      }
    });

    return flag;
  }
};