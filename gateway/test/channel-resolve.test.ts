import { describe, it, expect, vi } from 'vitest';
import { resolveTextChannel } from '../src/ui.js';
import type { Client, TextChannel } from 'discord.js';

describe('resolveTextChannel', () => {
  it('returns fetched channel when cache is empty', async () => {
    const fakeChannel = { id: '123', send: vi.fn() } as unknown as TextChannel;
    const client = {
      channels: {
        cache: new Map<string, unknown>(),
        fetch: vi.fn().mockResolvedValue(fakeChannel),
      },
    } as unknown as Client;
    const ch = await resolveTextChannel(client, '123');
    expect(client.channels.fetch).toHaveBeenCalledWith('123');
    expect(ch).toBe(fakeChannel);
  });
});
