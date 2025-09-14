import { describe, it, expect } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { withTimeout } from '../src/util.js';

describe('withTimeout helper', () => {
  it('resolves fast path', async () => {
    const res = await withTimeout(Promise.resolve(42), 50, 't');
    expect(res).toBe(42);
  });
  it.skip('returns undefined on timeout', async () => {
    const p = (async () => { await delay(200); return 1; })();
    const res = await withTimeout(p, 10, 't');
    expect(res).toBeUndefined();
  });
});
