import { describe, it, expect, vi } from 'vitest';
import { resolveTextChannel } from '../src/ui.js';

describe('resolveTextChannel', () => {
  it('returns fetched channel when cache is empty', async () => {
    const fakeChannel = { id: '123', send: vi.fn() } as any;
    const client = {
      channels: {
        cache: new Map(),
        fetch: vi.fn().mockResolvedValue(fakeChannel),
      },
    } as any;
    const ch = await resolveTextChannel(client, '123');
    expect(client.channels.fetch).toHaveBeenCalledWith('123');
    expect(ch).toBe(fakeChannel);
  });
});

