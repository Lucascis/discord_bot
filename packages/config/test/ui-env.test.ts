import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ui env defaults and overrides', () => {
  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_APPLICATION_ID = 'app-id';
    process.env.DATABASE_URL = 'postgresql://localhost/db';
    process.env.LAVALINK_PASSWORD = 'pass';
    delete process.env.NOWPLAYING_UPDATE_MS;
    delete process.env.COMMANDS_CLEANUP_ON_START;
  });

  it('has sane defaults', async () => {
    const mod = await import('../src/index.ts');
    expect(mod.env.NOWPLAYING_UPDATE_MS).toBe(5000);
    expect(mod.env.COMMANDS_CLEANUP_ON_START).toBe(false);
  });

  it('reads NOWPLAYING_UPDATE_MS and COMMANDS_CLEANUP_ON_START from env', async () => {
    process.env.NOWPLAYING_UPDATE_MS = '3000';
    process.env.COMMANDS_CLEANUP_ON_START = 'true';
    vi.resetModules();
    const mod = await import('../src/index.ts');
    expect(mod.env.NOWPLAYING_UPDATE_MS).toBe(3000);
    expect(mod.env.COMMANDS_CLEANUP_ON_START).toBe(true);
  });
});
