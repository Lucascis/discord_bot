import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@discord-bot/database', () => {
  return {
    prisma: {
      featureFlag: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

import { prisma } from '@discord-bot/database';
import { getAutomixEnabled, setAutomixEnabled, clearFlagCache } from '../src/flags.js';

describe('flags helpers', () => {
  type FnMock = ReturnType<typeof vi.fn>;
  const ff = prisma.featureFlag as unknown as { findUnique: FnMock; update: FnMock; create: FnMock };
  beforeEach(() => {
    ff.findUnique.mockReset();
    ff.update.mockReset();
    ff.create.mockReset();
    // Clear cache before each test to avoid interference
    clearFlagCache();
  });

  it('getAutomixEnabled checks "autoplay" flag', async () => {
    ff.findUnique.mockResolvedValueOnce({ enabled: true }); // autoplay
    const a = await getAutomixEnabled('g1');
    expect(a).toBe(true);
    expect(ff.findUnique).toHaveBeenCalledWith({ where: { guildId_name: { guildId: 'g1', name: 'autoplay' } }, select: { enabled: true } });
  });

  it('setAutomixEnabled updates existing autoplay or creates new', async () => {
    // Has autoplay
    ff.findUnique.mockResolvedValueOnce({ id: 'auto-id' }); // autoplay
    await setAutomixEnabled('g2', false);
    expect(ff.update).toHaveBeenCalledWith({ where: { id: 'auto-id' }, data: { enabled: false } });

    // No autoplay
    ff.findUnique.mockResolvedValueOnce(null); // autoplay
    await setAutomixEnabled('g3', true);
    expect(ff.create).toHaveBeenCalledWith({ data: { guildId: 'g3', name: 'autoplay', enabled: true } });
  });
});
