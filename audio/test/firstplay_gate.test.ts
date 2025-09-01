import { describe, it, expect } from 'vitest';
import { shouldSeedOnFirstPlay } from '../src/logic.js';

describe('first play seeding gate', () => {
  it('seeds only when autoplay enabled and player idle with no current', () => {
    expect(shouldSeedOnFirstPlay({ autoplayEnabled: true, playing: false, paused: false, hasCurrent: false })).toBe(true);
    expect(shouldSeedOnFirstPlay({ autoplayEnabled: false, playing: false, paused: false, hasCurrent: false })).toBe(false);
    expect(shouldSeedOnFirstPlay({ autoplayEnabled: true, playing: true, paused: false, hasCurrent: false })).toBe(false);
    expect(shouldSeedOnFirstPlay({ autoplayEnabled: true, playing: false, paused: true, hasCurrent: false })).toBe(false);
    expect(shouldSeedOnFirstPlay({ autoplayEnabled: true, playing: false, paused: false, hasCurrent: true })).toBe(false);
  });
});

