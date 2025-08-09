import { describe, expect, it } from 'vitest';
import { logger } from '../src';

describe('logger', () => {
  it('creates logger', () => {
    expect(logger).toBeTruthy();
  });
});
