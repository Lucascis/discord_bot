// Simple per-guild mutex to serialize queue/player mutations.
// Design: a Map<guildId, Promise<void>> acts as a chain. Each run() attaches
// a new promise to the end of the chain ensuring FIFO execution.
// Timeouts: if a task exceeds MAX_LOCK_MS, a warning log can be emitted externally.

export type GuildMutexTask<T> = () => Promise<T> | T;

class GuildMutex {
  private chains = new Map<string, Promise<unknown>>();

  async run<T>(guildId: string, task: GuildMutexTask<T>): Promise<T> {
    // Get the current chain promise
    const prev = this.chains.get(guildId) || Promise.resolve();

    // Create a new promise for the next task to wait on
    let resolveNext: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    // Chain the next promise to execute after current one finishes
    const chainPromise = prev.then(() => nextPromise);
    this.chains.set(guildId, chainPromise);

    try {
      // Wait for previous task to complete
      await prev;

      // Execute our task
      const result = await task();

      // Return the result
      return result;
    } catch (error) {
      throw error;
    } finally {
      // Signal that this task is done
      resolveNext!();

      // Clean up if no new tasks were added
      if (this.chains.get(guildId) === chainPromise) {
        this.chains.delete(guildId);
      }
    }
  }
}

export const guildMutex = new GuildMutex();
