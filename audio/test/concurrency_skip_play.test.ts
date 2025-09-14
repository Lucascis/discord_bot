import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { guildMutex } from '../src/guildMutex.js';

// Synthetic test to ensure serialization: we simulate N concurrent tasks appending to an array
// and assert order is preserved (no overlaps) and length matches.

describe('guildMutex concurrency', () => {
  beforeEach(() => {
    // Clear mutex state before each test to avoid interference
    guildMutex.clearAll();
  });

  afterEach(() => {
    // Clean up after each test as well
    guildMutex.clearAll();
  });

  it('serializes tasks for same guild', { timeout: 30000 }, async () => {
    const seq: number[] = [];
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        guildMutex.run('g1', async () => {
          const before = seq.length;
          // artificial async gap
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
          seq.push(i);
          const after = seq.length;
          // ensure no other task modified in between (length should be before+1)
          expect(after).toBe(before + 1);
        }),
      ),
    );
    expect(seq.length).toBe(N);
  });

  it('allows parallelism across different guilds', async () => {
    const started: string[] = [];
    await Promise.all([
      guildMutex.run('a', async () => { started.push('a'); }),
      guildMutex.run('b', async () => { started.push('b'); }),
    ]);
    // Order may vary but both executed
    expect(new Set(started)).toEqual(new Set(['a', 'b']));
  });
});
