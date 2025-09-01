import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '../src/autoplay.js';

describe('normalizeTitle', () => {
  it('strips remix/edit/version brackets and tokens', () => {
    expect(normalizeTitle('Underworld (Volen Sentir Remix)')).toBe('underworld');
    expect(normalizeTitle('Underworld - Lost Desert Remix')).toBe('underworld');
    expect(normalizeTitle('Underworld [Radio Edit]')).toBe('underworld');
    expect(normalizeTitle('Underworld feat. Someone')).toBe('underworld');
  });
});

