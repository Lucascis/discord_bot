import { type BaseGuildVoiceChannel, Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { EndBehaviorType, VoiceConnectionStatus, entersState, joinVoiceChannel } from '@discordjs/voice';
import prism from 'prism-media';
import { pcm16ToRms, hasConsecutiveAudibleWindows } from './rms.js';
import type { ProbeConfig, ProbeResult, ProbeWindow } from './types.js';

function resolveProbeUserId(
  connection: ReturnType<typeof joinVoiceChannel>,
  voiceChannel: BaseGuildVoiceChannel,
  botUserId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const fallbackBotUser = voiceChannel.members.find(
        (member) => member.id !== botUserId && member.user.bot
      );
      const fallbackUser = fallbackBotUser ?? voiceChannel.members.find((member) => member.id !== botUserId);
      if (fallbackUser) {
        resolve(fallbackUser.id);
        return;
      }
      reject(new Error('Probe did not receive any speaking user'));
    }, 20000);

    connection.receiver.speaking.on('start', (userId: string) => {
      if (userId === botUserId) {
        return;
      }
      clearTimeout(timeout);
      resolve(userId);
    });
  });
}

function getCandidateUserIds(
  voiceChannel: BaseGuildVoiceChannel,
  probeUserId: string,
  preferredUserId: string
): string[] {
  const fallbackIds = voiceChannel.members
    .filter((member) => member.id !== probeUserId)
    .sort((a, b) => Number(b.user.bot) - Number(a.user.bot))
    .map((member) => member.id);

  const ordered = [preferredUserId, ...fallbackIds];
  return [...new Set(ordered)];
}

function waitForDecoderChunk(decoder: prism.opus.Decoder, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      clearTimeout(timeout);
      decoder.off('data', onData);
      resolve(data);
    };
    const timeout = setTimeout(() => {
      decoder.off('data', onData);
      resolve(null);
    }, timeoutMs);
    decoder.on('data', onData);
  });
}

async function probeCandidateAudio(
  connection: ReturnType<typeof joinVoiceChannel>,
  userId: string,
  config: ProbeConfig,
  windows: ProbeWindow[],
  maxRms: number,
  timeoutMs: number
): Promise<{ passed: boolean; maxRms: number }> {
  const opusStream = connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.Manual,
    },
  });

  const decoder = new prism.opus.Decoder({
    frameSize: 960,
    channels: 2,
    rate: 48000,
  });
  opusStream.pipe(decoder);

  let localMaxRms = maxRms;
  let pcmBuffer = Buffer.alloc(0);
  const windowBytes = Math.floor((48000 * 2 * 2 * config.windowMs) / 1000);
  const deadline = Date.now() + timeoutMs;
  let lastChunkAt = Date.now();

  try {
    while (Date.now() < deadline) {
      const chunk = await waitForDecoderChunk(decoder, 100);
      if (!chunk) {
        if (Date.now() - lastChunkAt > 5000) {
          break;
        }
        continue;
      }
      lastChunkAt = Date.now();

      pcmBuffer = Buffer.concat([pcmBuffer, chunk]);
      while (pcmBuffer.length >= windowBytes) {
        const window = pcmBuffer.subarray(0, windowBytes);
        pcmBuffer = pcmBuffer.subarray(windowBytes);
        const rms = pcm16ToRms(window);
        localMaxRms = Math.max(localMaxRms, rms);
        windows.push({
          rms,
          timestamp: Date.now(),
        });
      }

      if (hasConsecutiveAudibleWindows(windows, config.rmsThreshold, config.consecutiveWindows)) {
        return { passed: true, maxRms: localMaxRms };
      }
    }

    return { passed: false, maxRms: localMaxRms };
  } finally {
    opusStream.destroy();
    decoder.destroy();
  }
}

export async function runDiscordAudioProbe(config: ProbeConfig): Promise<ProbeResult> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const windows: ProbeWindow[] = [];
  let maxRms = 0;
  try {
    await client.login(config.token);
    if (!client.isReady()) {
      await new Promise<void>((resolve) => {
        client.once('clientReady', () => resolve());
      });
    }

    const guild = await client.guilds.fetch(config.guildId);
    const voiceChannel = await guild.channels.fetch(config.voiceChannelId);

    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      return {
        passed: false,
        windows,
        maxRms,
        reason: 'Voice channel not found for probe bot',
      };
    }

    const probeUser = client.user;
    if (!probeUser) {
      return {
        passed: false,
        windows,
        maxRms,
        reason: 'Probe bot user id unavailable',
      };
    }

    const permissions = voiceChannel.permissionsFor(probeUser);
    const canView = permissions?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
    const canConnect = permissions?.has(PermissionsBitField.Flags.Connect) ?? false;
    if (!canView || !canConnect) {
      return {
        passed: false,
        windows,
        maxRms,
        reason: `Probe bot missing voice permissions on channel (${voiceChannel.id}): view=${canView} connect=${canConnect}`,
      };
    }

    const connection = joinVoiceChannel({
      guildId: config.guildId,
      channelId: config.voiceChannelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    const probeUserId = probeUser.id;

    const speakingUserId = await resolveProbeUserId(connection, voiceChannel, probeUserId);
    const candidateUserIds = getCandidateUserIds(voiceChannel, probeUserId, speakingUserId);
    const overallDeadline = Date.now() + config.timeoutMs;

    for (const candidateUserId of candidateUserIds) {
      const remaining = overallDeadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      const perCandidateTimeout = Math.min(remaining, 20000);
      const result = await probeCandidateAudio(
        connection,
        candidateUserId,
        config,
        windows,
        maxRms,
        perCandidateTimeout
      );
      maxRms = result.maxRms;

      if (result.passed) {
        connection.destroy();
        return {
          passed: true,
          windows,
          maxRms,
        };
      }
    }

    connection.destroy();

    return {
      passed: false,
      windows,
      maxRms,
      reason: `RMS threshold not reached: max=${maxRms.toFixed(4)} threshold=${config.rmsThreshold}`,
    };
  } finally {
    client.destroy();
  }
}
