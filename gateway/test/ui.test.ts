import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal discord.js mocks tailored for MusicUIBuilder tests
vi.mock('discord.js', () => {
  class ActionRowBuilder<T = any> {
    components: T[] = [];
    addComponents(...components: T[]) {
      this.components.push(...components);
      return this;
    }
  }

  class ButtonBuilder {
    data: Record<string, any> = {};
    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }
    setLabel(label: string) {
      this.data.label = label;
      return this;
    }
    setStyle(style: number) {
      this.data.style = style;
      return this;
    }
    setDisabled(disabled: boolean) {
      this.data.disabled = disabled;
      return this;
    }
    setEmoji(emoji: string) {
      this.data.emoji = emoji;
      return this;
    }
  }

  class EmbedBuilder {
    data: Record<string, any> = { fields: [] };
    setColor(color: number) {
      this.data.color = color;
      return this;
    }
    setTitle(title: string) {
      this.data.title = title;
      return this;
    }
    setDescription(description: string) {
      this.data.description = description;
      return this;
    }
    addFields(...fields: Array<{ name: string; value: string; inline?: boolean }>) {
      this.data.fields.push(...fields);
      return this;
    }
    setFooter(footer: { text: string; iconURL?: string }) {
      this.data.footer = footer;
      return this;
    }
    setThumbnail(url: string) {
      this.data.thumbnail = url;
      return this;
    }
    setTimestamp() {
      this.data.timestamp = true;
      return this;
    }
  }

  class StringSelectMenuOptionBuilder {
    data: Record<string, any> = {};
    setLabel(label: string) {
      this.data.label = label;
      return this;
    }
    setValue(value: string) {
      this.data.value = value;
      return this;
    }
    setDescription(description: string) {
      this.data.description = description;
      return this;
    }
    setDefault(isDefault: boolean) {
      this.data.default = isDefault;
      return this;
    }
  }

  class StringSelectMenuBuilder {
    data: Record<string, any> = { options: [] };
    setCustomId(id: string) {
      this.data.custom_id = id;
      return this;
    }
    setPlaceholder(placeholder: string) {
      this.data.placeholder = placeholder;
      return this;
    }
    addOptions(options: StringSelectMenuOptionBuilder[]) {
      this.data.options = options;
      return this;
    }
  }

  return {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle: {
      Primary: 1,
      Secondary: 2,
      Success: 3,
      Danger: 4,
    },
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
  };
});

import { MusicUIBuilder } from '../src/presentation/ui/music-ui-builder.js';

type ButtonRow = { components: Array<{ data: Record<string, any> }> };

function findButton(rows: ButtonRow[], customId: string) {
  for (const row of rows) {
    const match = row.components.find((component) => component.data.custom_id === customId);
    if (match) return match;
  }
  return undefined;
}

describe('MusicUIBuilder controls', () => {
  let builder: MusicUIBuilder;

  beforeEach(() => {
    builder = new MusicUIBuilder();
  });

  it('enables Skip when a track is playing even with empty queue', () => {
    const controls = builder.buildMusicControlButtons({
      isPlaying: true,
      isPaused: false,
      hasQueue: false,
      queueLength: 0,
      volume: 75,
      loopMode: 'off',
      autoplayMode: 'off',
    }) as unknown as ButtonRow[];

    const skipButton = findButton(controls, 'music_skip');
    expect(skipButton).toBeTruthy();
    expect(skipButton?.data.disabled).toBe(false);
  });

  it('disables Skip when no track present', () => {
    const controls = builder.buildMusicControlButtons({
      isPlaying: false,
      isPaused: false,
      hasQueue: false,
      queueLength: 0,
      volume: 75,
      loopMode: 'off',
      autoplayMode: 'off',
    }) as unknown as ButtonRow[];

    const skipButton = findButton(controls, 'music_skip');
    expect(skipButton).toBeTruthy();
    expect(skipButton?.data.disabled).toBe(true);
  });

  it('disables Filters button until audio is playing or paused', () => {
    const idleControls = builder.buildMusicControlButtons({
      isPlaying: false,
      isPaused: false,
      hasQueue: false,
      queueLength: 0,
      volume: 100,
      loopMode: 'off',
      autoplayMode: 'off',
    }) as unknown as ButtonRow[];

    const idleFilter = findButton(idleControls, 'music_filters');
    expect(idleFilter?.data.disabled).toBe(true);

    const activeControls = builder.buildMusicControlButtons({
      isPlaying: true,
      isPaused: false,
      hasQueue: false,
      queueLength: 0,
      volume: 100,
      loopMode: 'off',
      autoplayMode: 'off',
      activeFilterId: 'clarity',
      activeFilterLabel: 'Studio Clarity',
    }) as unknown as ButtonRow[];

    const activeFilter = findButton(activeControls, 'music_filters');
    expect(activeFilter?.data.disabled).toBe(false);
    expect(activeFilter?.data.label).toContain('Studio Clarity');
  });
});

describe('MusicUIBuilder panels', () => {
  let builder: MusicUIBuilder;

  beforeEach(() => {
    builder = new MusicUIBuilder();
  });

  it('builds filter panel with active preset selected', () => {
    const { embeds, components } = builder.buildFilterPanel({
      success: true,
      preset: { id: 'clarity', label: 'Studio Clarity', description: 'Boosts vocals' },
      presets: [
        { id: 'flat', label: 'Flat' },
        { id: 'clarity', label: 'Studio Clarity', description: 'Boosts vocals' },
      ],
      message: 'Studio Clarity enabled.',
    });

    const embedData = embeds[0].data;
    expect(embedData.title).toBe('🎚️ Audio Filters');
    expect(embedData.description).toContain('Studio Clarity');
    expect(embedData.footer?.text).toContain('Studio Clarity enabled.');

    const selectMenu = components[0].components[0] as unknown as { data: Record<string, any> };
    expect(selectMenu.data.options).toHaveLength(2);
    const clarityOption = selectMenu.data.options.find((opt: any) => opt.data.value === 'clarity');
    expect(clarityOption?.data.default).toBe(true);

    const resetButtonRow = components[1] as unknown as ButtonRow;
    const resetButton = findButton([resetButtonRow], 'filters_reset');
    expect(resetButton?.data.disabled).toBe(false);
    expect(resetButton?.data.style).toBe(4); // Danger
  });

  it('disables reset button when Flat preset active', () => {
    const { components } = builder.buildFilterPanel({
      success: true,
      preset: { id: 'flat', label: 'Flat', description: 'All enhancements disabled' },
      presets: [{ id: 'flat', label: 'Flat' }],
    });

    const resetButtonRow = components[1] as unknown as ButtonRow;
    const resetButton = findButton([resetButtonRow], 'filters_reset');
    expect(resetButton?.data.disabled).toBe(true);
  });
});

describe('MusicUIBuilder embeds', () => {
  let builder: MusicUIBuilder;

  beforeEach(() => {
    builder = new MusicUIBuilder();
  });

  it('includes filter information in Now Playing embed', () => {
    const embed = builder.buildNowPlayingEmbed({
      trackTitle: 'Song Title',
      artist: 'Artist',
      duration: 300000,
      position: 150000,
      volume: 80,
      loopMode: 'queue',
      queueLength: 3,
      isPaused: false,
      autoplayMode: 'mixed',
      filter: {
        id: 'clarity',
        label: 'Studio Clarity',
        description: 'Boosts vocals and highs for crisp detail.',
      },
    });

    const filterField = embed.data.fields.find((field: any) => field.name === '🎛️ Filter');
    expect(filterField).toBeTruthy();
    expect(filterField?.value).toContain('Studio Clarity');
  });
});
