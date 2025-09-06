// Simple per-guild mutex to serialize queue/player mutations.
// Design: a Map<guildId, Promise<void>> acts as a chain. Each run() attaches
// a new promise to the end of the chain ensuring FIFO execution.
// Timeouts: if a task exceeds MAX_LOCK_MS, a warning log can be emitted externally.

export type GuildMutexTask<T> = () => Promise<T> | T;

class GuildMutex {
  private chains = new Map<string, Promise<unknown>>();

  async run<T>(guildId: string, task: GuildMutexTask<T>): Promise<T> {
    const prev = this.chains.get(guildId) || Promise.resolve();
    let release: () => void;
    const p = new Promise<void>((res) => { release = res; });
    // Chain next before executing to avoid race if task throws fast.
    this.chains.set(guildId, prev.then(() => p));

    try {
      await prev; // wait previous chain
      return await task();
    } finally {
      // release current link
      release!();
      // Garbage collect completed chains to avoid unbounded growth
      const current = this.chains.get(guildId);
      if (current === p) {
        // If nobody chained after us yet, keep minimal resolved promise
        // to ensure future tasks still await something resolved.
        this.chains.set(guildId, Promise.resolve());
      }
    }
  }
}

export const guildMutex = new GuildMutex();
