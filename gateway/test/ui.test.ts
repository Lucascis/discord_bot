import { describe, it, expect } from 'vitest';
import { buildControls } from '../src/ui.js';

describe('UI controls', () => {
  it('enables Skip when a track is playing even if queue is empty', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: true, queueLen: 0, canSeek: true });
    const row1 = controls[0];
    // @ts-ignore - access components array
    const btns = row1.components as any[];
    const skip = btns.find((b) => b.data?.custom_id === 'music:skip');
    expect(skip).toBeTruthy();
    expect(skip.data.disabled).toBe(false);
  });

  it('disables Skip when no track present', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: false, queueLen: 3, canSeek: false });
    const row1 = controls[0];
    // @ts-ignore - access components array
    const btns = row1.components as any[];
    const skip = btns.find((b) => b.data?.custom_id === 'music:skip');
    expect(skip).toBeTruthy();
    expect(skip.data.disabled).toBe(true);
  });

  it('disables Queue button when queue is empty', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: true, queueLen: 0, canSeek: true });
    const row2 = controls[1];
    // @ts-ignore - access components array
    const btns = row2.components as any[];
    const queueBtn = btns.find((b) => b.data?.custom_id === 'music:queue');
    expect(queueBtn).toBeTruthy();
    expect(queueBtn.data.disabled).toBe(true);
  });
});
