import { describe, it, expect } from 'vitest';
import { shouldRefillQueue, shouldAutomixAfterSkip, shouldUseSkip } from '../src/logic.js';

describe('logic helpers', () => {
  it('shouldRefillQueue triggers when below threshold', () => {
    expect(shouldRefillQueue(0)).toBe(true);
    expect(shouldRefillQueue(2, 3)).toBe(true);
    expect(shouldRefillQueue(3, 3)).toBe(false);
    expect(shouldRefillQueue(10, 3)).toBe(false);
  });

  it('shouldAutomixAfterSkip detects empty-idle-off-autoplay', () => {
    expect(shouldAutomixAfterSkip({ repeatMode: 'off', playing: false, hasCurrent: false, queueLen: 0, autoplayEnabled: true })).toBe(true);
    expect(shouldAutomixAfterSkip({ repeatMode: 'track', playing: false, hasCurrent: false, queueLen: 0, autoplayEnabled: true })).toBe(false);
    expect(shouldAutomixAfterSkip({ repeatMode: 'off', playing: true, hasCurrent: false, queueLen: 0, autoplayEnabled: true })).toBe(false);
    expect(shouldAutomixAfterSkip({ repeatMode: 'off', playing: false, hasCurrent: true, queueLen: 0, autoplayEnabled: true })).toBe(false);
    expect(shouldAutomixAfterSkip({ repeatMode: 'off', playing: false, hasCurrent: false, queueLen: 1, autoplayEnabled: true })).toBe(false);
    expect(shouldAutomixAfterSkip({ repeatMode: 'off', playing: false, hasCurrent: false, queueLen: 0, autoplayEnabled: false })).toBe(false);
  });

  it('shouldUseSkip only when queueLen > 0', () => {
    expect(shouldUseSkip(0)).toBe(false);
    expect(shouldUseSkip(1)).toBe(true);
  });
});
