import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitMiddleware, PermissionMiddleware, EnabledMiddleware } from '../src/middleware/validation.js';
import type { BaseCommand, CommandContext } from '../src/base/command.js';

describe('commands middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('RateLimitMiddleware enforces limits per user/command', async () => {
    const rl = new RateLimitMiddleware();
    const ctx = { guildId: 'g1', userId: 'u1', channelId: 'c1', interaction: {} as unknown as import('discord.js').Interaction } as CommandContext;
    const cmd = { metadata: { name: 'play', description: '', category: 'music', rateLimit: { limit: 2, windowSeconds: 60 } } } as unknown as BaseCommand;

    const a = await rl.validate(ctx, cmd); expect(a.success).toBe(true);
    const b = await rl.validate(ctx, cmd); expect(b.success).toBe(true);
    const c = await rl.validate(ctx, cmd); expect(c.success).toBe(false);
  });

  it('PermissionMiddleware checks DJ/Admin when required', async () => {
    const hasDjOrAdmin = vi.fn().mockReturnValue(false);
    const pm = new PermissionMiddleware(hasDjOrAdmin);
    const ctx = { guildId: 'g1', userId: 'u1', channelId: 'c1', interaction: {} as unknown as import('discord.js').Interaction } as CommandContext;
    const cmd = { metadata: { name: 'skip', description: '', category: 'music', permissions: { requiresDjRole: true } } } as unknown as BaseCommand;

    const res = await pm.validate(ctx, cmd);
    expect(res.success).toBe(false);
    expect(hasDjOrAdmin).toHaveBeenCalled();
  });

  it('EnabledMiddleware blocks disabled commands', async () => {
    const em = new EnabledMiddleware();
    const ctx = { guildId: 'g', userId: 'u', channelId: 'c', interaction: {} as unknown as import('discord.js').Interaction } as CommandContext;
    const cmd = { metadata: { name: 'test', description: '', category: 'misc', enabled: false } } as unknown as BaseCommand;
    const res = await em.validate(ctx, cmd);
    expect(res.success).toBe(false);
  });
});

