import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('premium test guild environment handling', () => {
  const requiredEnv = {
    DISCORD_TOKEN: 'token',
    DISCORD_APPLICATION_ID: '123456789012345678',
    DATABASE_URL: 'postgresql://localhost/db',
    LAVALINK_PASSWORD: 'super-secret',
  };

  beforeEach(() => {
    Object.assign(process.env, requiredEnv);
  });

  afterEach(() => {
    delete process.env.PREMIUM_TEST_GUILD_IDS;
    for (const key of Object.keys(requiredEnv)) {
      delete process.env[key];
    }
    vi.resetModules();
  });

  it('deduplicates and filters invalid guild identifiers', async () => {
    process.env.PREMIUM_TEST_GUILD_IDS =
      '123456789012345678,not-a-guild,123456789012345678, 987654321098765432 ';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../src/index.ts');

    expect(mod.env.PREMIUM_TEST_GUILD_IDS_LIST).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('Ignoring invalid PREMIUM_TEST_GUILD_IDS entries');

    warnSpy.mockRestore();
  });
});
