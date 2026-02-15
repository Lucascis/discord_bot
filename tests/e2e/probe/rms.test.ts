import { describe, expect, it } from 'vitest';
import { pcm16ToRms, hasConsecutiveAudibleWindows } from './rms.js';

describe('audio probe RMS helpers', () => {
  it('computes RMS for pcm16 samples', () => {
    const buffer = Buffer.alloc(8);
    buffer.writeInt16LE(10000, 0);
    buffer.writeInt16LE(-10000, 2);
    buffer.writeInt16LE(10000, 4);
    buffer.writeInt16LE(-10000, 6);

    const rms = pcm16ToRms(buffer);
    expect(rms).toBeGreaterThan(0.2);
    expect(rms).toBeLessThan(0.5);
  });

  it('detects consecutive audible windows', () => {
    const windows = [
      { rms: 0.001, timestamp: 1 },
      { rms: 0.02, timestamp: 2 },
      { rms: 0.03, timestamp: 3 },
      { rms: 0.025, timestamp: 4 },
    ];

    expect(hasConsecutiveAudibleWindows(windows, 0.015, 3)).toBe(true);
    expect(hasConsecutiveAudibleWindows(windows, 0.03, 2)).toBe(false);
  });
});
