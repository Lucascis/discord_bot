import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type TextChannel, type Client } from 'discord.js';

export type UiState = { autoplayOn: boolean; loopMode: 'off' | 'track' | 'queue'; paused: boolean; hasTrack: boolean; queueLen: number; canSeek: boolean };

export function buildControls(state: UiState) {
  const { autoplayOn, loopMode, paused, hasTrack, queueLen, canSeek } = state;
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('music:toggle').setLabel('⏯️ Play/Pause').setStyle(paused ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!hasTrack),
    new ButtonBuilder().setCustomId('music:seekback').setLabel('⏪ -10s').setStyle(ButtonStyle.Secondary).setDisabled(!hasTrack || !canSeek),
    new ButtonBuilder().setCustomId('music:seekfwd').setLabel('⏩ +10s').setStyle(ButtonStyle.Secondary).setDisabled(!hasTrack || !canSeek),
    // Allow skip if a track is currently playing, even with empty queue
    new ButtonBuilder().setCustomId('music:skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Primary).setDisabled(!hasTrack),
    new ButtonBuilder().setCustomId('music:stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger).setDisabled(!hasTrack),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('music:shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary).setDisabled(queueLen < 2),
    new ButtonBuilder().setCustomId('music:queue').setLabel('🗒️ Queue').setStyle(ButtonStyle.Secondary).setDisabled(queueLen === 0),
    new ButtonBuilder().setCustomId('music:clear').setLabel('🧹 Clear').setStyle(ButtonStyle.Secondary).setDisabled(queueLen === 0),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('music:voldown').setLabel('🔉 Vol -').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:volup').setLabel('🔊 Vol +').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:loop').setLabel('🔁 Loop').setStyle(loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('music:autoplay').setLabel('▶️ Autoplay').setStyle(autoplayOn ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return [row1, row2, row3] as const;
}

export async function resolveTextChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  const cached = client.channels.cache.get(channelId) as TextChannel | undefined;
  if (cached) return cached;
  try {
    const fetched = (await client.channels.fetch(channelId)) as TextChannel | null;
    return fetched;
  } catch { return null; }
}
