import { describe, it, expect, vi } from 'vitest';

// Mock Discord.js components
vi.mock('discord.js', () => ({
  ActionRowBuilder: class ActionRowBuilder {
    components: any[] = [];
    addComponents(...components: any[]) {
      this.components = components;
      return this;
    }
  },
  ButtonBuilder: class ButtonBuilder {
    data: any = {};
    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }
    setLabel(label: string) {
      this.data.label = label;
      return this;
    }
    setStyle(style: any) {
      this.data.style = style;
      return this;
    }
    setDisabled(disabled: boolean) {
      this.data.disabled = disabled;
      return this;
    }
  },
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4
  }
}));

import { buildControls } from '../src/ui.js';

describe('UI controls', () => {
  it('enables Skip when a track is playing even if queue is empty', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: true, queueLen: 0, canSeek: true });
    const row1 = controls[0] as unknown as { components: Array<{ data?: { custom_id?: string; disabled?: boolean } }> };
    const btns = row1.components;
    const skip = btns.find((b) => b.data?.custom_id === 'music:skip');
    expect(skip).toBeTruthy();
    expect(skip.data.disabled).toBe(false);
  });

  it('disables Skip when no track present', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: false, queueLen: 3, canSeek: false });
    const row1 = controls[0] as unknown as { components: Array<{ data?: { custom_id?: string; disabled?: boolean } }> };
    const btns = row1.components;
    const skip = btns.find((b) => b.data?.custom_id === 'music:skip');
    expect(skip).toBeTruthy();
    expect(skip.data.disabled).toBe(true);
  });

  it('disables Queue button when queue is empty', () => {
    const controls = buildControls({ autoplayOn: false, loopMode: 'off', paused: false, hasTrack: true, queueLen: 0, canSeek: true });
    const row3 = controls[2] as unknown as { components: Array<{ data?: { custom_id?: string; disabled?: boolean } }> };
    const btns = row3.components;
    const queueBtn = btns.find((b) => b.data?.custom_id === 'music:queue');
    expect(queueBtn).toBeTruthy();
    expect(queueBtn.data.disabled).toBe(true);
  });
});
