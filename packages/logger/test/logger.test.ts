import { describe, expect, it } from 'vitest';
import { logger } from '../src/index.js';

describe('logger', () => {
  it('creates logger', () => {
    expect(logger).toBeTruthy();
  });
});
