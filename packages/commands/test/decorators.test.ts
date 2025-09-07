import { describe, it, expect } from 'vitest';
import { Permissions, RateLimit, Category, Enabled, getCommandMetadata } from '../src/base/decorators.js';

class TestCommand {}

// Apply decorators programmatically to avoid TS experimentalDecorators requirement in tests
Permissions({ requiresDjRole: true, requiresVoiceChannel: true })(TestCommand);
RateLimit(3, 30)(TestCommand);
Category('music')(TestCommand);
Enabled(true)(TestCommand);

describe('commands decorators', () => {
  it('should store metadata via decorators', () => {
    const meta = getCommandMetadata(TestCommand);
    expect(meta.permissions?.requiresDjRole).toBe(true);
    expect(meta.permissions?.requiresVoiceChannel).toBe(true);
    expect(meta.rateLimit?.limit).toBe(3);
    expect(meta.rateLimit?.windowSeconds).toBe(30);
    expect(meta.category).toBe('music');
    expect(meta.enabled).toBe(true);
  });
});
