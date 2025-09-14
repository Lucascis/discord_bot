// Simple per-guild mutex to serialize queue/player mutations.
// Design: Each guild has a queue of tasks that execute sequentially.

export type GuildMutexTask<T> = () => Promise<T> | T;

interface QueuedTask<T> {
  task: GuildMutexTask<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

class GuildMutex {
  private queues = new Map<string, QueuedTask<unknown>[]>();
  private running = new Set<string>();

  async run<T>(guildId: string, task: GuildMutexTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Add task to queue
      if (!this.queues.has(guildId)) {
        this.queues.set(guildId, []);
      }

      const queue = this.queues.get(guildId)!;
      queue.push({ task, resolve, reject } as QueuedTask<unknown>);

      // Start processing if not already running
      if (!this.running.has(guildId)) {
        this.processQueue(guildId);
      }
    });
  }

  private async processQueue(guildId: string): Promise<void> {
    if (this.running.has(guildId)) {
      return;
    }

    this.running.add(guildId);

    try {
      const queue = this.queues.get(guildId);
      if (!queue) {
        return;
      }

      while (queue.length > 0) {
        const queuedTask = queue.shift()!;

        try {
          const result = await queuedTask.task();
          queuedTask.resolve(result);
        } catch (error) {
          queuedTask.reject(error);
        }
      }

      // Clean up empty queue
      if (queue.length === 0) {
        this.queues.delete(guildId);
      }
    } finally {
      this.running.delete(guildId);
    }
  }
}

export const guildMutex = new GuildMutex();
