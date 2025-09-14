// Simple per-guild mutex to serialize queue/player mutations.
// Design: a Map<guildId, Promise<void>> acts as a chain. Each run() attaches
// a new promise to the end of the chain ensuring FIFO execution.

export type GuildMutexTask<T> = () => Promise<T> | T;

class GuildMutex {
  private chains = new Map<string, Promise<void>>();

  // Method to clear all state - useful for testing
  public clearAll(): void {
    this.chains.clear();
  }

  async run<T>(guildId: string, task: GuildMutexTask<T>): Promise<T> {
    // Get the current chain promise for this guild
    const previousPromise = this.chains.get(guildId) || Promise.resolve();

    // Create a promise for this task that will resolve when the task completes
    let resolveThisTask: () => void;
    const thisTaskPromise = new Promise<void>((resolve) => {
      resolveThisTask = resolve;
    });

    // Chain this task promise after the previous one
    this.chains.set(guildId, previousPromise.then(() => thisTaskPromise));

    // Wait for the previous task to complete, then run our task
    try {
      await previousPromise;
      const result = await task();
      return result;
    } finally {
      // Mark this task as complete so the next one can run
      resolveThisTask!();
    }
  }
}

export const guildMutex = new GuildMutex();
