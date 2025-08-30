import { beforeEach, describe, expect, it } from 'vitest';

describe('env', () => {
  beforeEach(() => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DATABASE_URL = 'postgresql://localhost/db';
    process.env.LAVALINK_PASSWORD = 'pass';
  });

  it('parses variables', async () => {
    const { env } = await import('../src');
    expect(env.DISCORD_TOKEN).toBe('token');
    expect(env.LAVALINK_PORT).toBe(2333);
  });
});
