import { describe, it, expect } from 'vitest';
import { isBlockReason, buildAutomixCandidates } from '../src/autoplay.js';

describe('autoplay helpers', () => {
  it('blocks only explicit non-finished reasons', () => {
    expect(isBlockReason(undefined)).toBe(false);
    expect(isBlockReason(null as unknown as string)).toBe(false);
    expect(isBlockReason('finished')).toBe(false);
    expect(isBlockReason('FINISHED')).toBe(false);
    expect(isBlockReason('stopped')).toBe(true);
    expect(isBlockReason('replaced')).toBe(true);
    expect(isBlockReason('cleanup')).toBe(true);
    expect(isBlockReason('load_failed')).toBe(true);
    expect(isBlockReason('loadfailed')).toBe(true);
  });

  it('builds candidates with ytsearch fallbacks', () => {
    const c = buildAutomixCandidates('Song', 'Artist', '');
    const joined = c.join(' | ');
    expect(joined).toContain('ytmsearch:');
    expect(joined).toContain('ytsearch:');
    expect(joined).toContain('official');
  });

  it('includes spsearch when uri is spotify track', () => {
    const c = buildAutomixCandidates('Song', 'Artist', 'https://open.spotify.com/track/abc');
    expect(c.some((q) => q.startsWith('spsearch:'))).toBe(true);
  });
});

