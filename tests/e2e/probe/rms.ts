import type { ProbeWindow } from './types.js';

export function pcm16ToRms(buffer: Buffer): number {
  if (buffer.length < 2) {
    return 0;
  }

  const samples = Math.floor(buffer.length / 2);
  let sumSquares = 0;

  for (let i = 0; i < samples; i += 1) {
    const sample = buffer.readInt16LE(i * 2) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / samples);
}

export function hasConsecutiveAudibleWindows(
  windows: ProbeWindow[],
  threshold: number,
  consecutiveWindows: number
): boolean {
  let streak = 0;
  for (const window of windows) {
    if (window.rms > threshold) {
      streak += 1;
      if (streak >= consecutiveWindows) {
        return true;
      }
      continue;
    }
    streak = 0;
  }

  return false;
}
