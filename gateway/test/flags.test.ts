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
import { getAutomixEnabled, setAutomixEnabled } from '../src/flags.js';

describe('flags helpers', () => {
  type FnMock = ReturnType<typeof vi.fn>;
  const ff = prisma.featureFlag as unknown as { findUnique: FnMock; update: FnMock; create: FnMock };
  beforeEach(() => {
    ff.findUnique.mockReset();
    ff.update.mockReset();
    ff.create.mockReset();
  });

  it('getAutomixEnabled prefers "autoplay" but supports legacy "automix"', async () => {
    ff.findUnique
      .mockResolvedValueOnce({ enabled: false }) // autoplay
      .mockResolvedValueOnce({ enabled: true }); // automix (legacy)
    // Because first is false, we should still return false without checking legacy
    const a = await getAutomixEnabled('g1');
    expect(a).toBe(false);

    ff.findUnique
      .mockResolvedValueOnce(null) // autoplay
      .mockResolvedValueOnce({ enabled: true }); // automix (legacy)
    const b = await getAutomixEnabled('g1');
    expect(b).toBe(true);
  });

  it('setAutomixEnabled migrates legacy record to autoplay', async () => {
    ff.findUnique
      .mockResolvedValueOnce({ id: 'legacy-id' }); // legacy automix exists
    await setAutomixEnabled('g1', true);
    expect(ff.update).toHaveBeenCalledWith({ where: { id: 'legacy-id' }, data: { enabled: true, name: 'autoplay' } });
  });

  it('setAutomixEnabled updates existing autoplay or creates new', async () => {
    // No legacy, has autoplay
    ff.findUnique
      .mockResolvedValueOnce(null) // legacy
      .mockResolvedValueOnce({ id: 'auto-id' }); // autoplay
    await setAutomixEnabled('g2', false);
    expect(ff.update).toHaveBeenCalledWith({ where: { id: 'auto-id' }, data: { enabled: false } });

    // No legacy, no autoplay
    ff.findUnique
      .mockResolvedValueOnce(null) // legacy
      .mockResolvedValueOnce(null); // autoplay
    await setAutomixEnabled('g3', true);
    expect(ff.create).toHaveBeenCalledWith({ data: { guildId: 'g3', name: 'autoplay', enabled: true } });
  });
});
