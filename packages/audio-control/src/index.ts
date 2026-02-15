import { RedisStreamsManager, redisStreams, type StreamResponseData } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';
import { randomUUID } from 'node:crypto';

type CommandPayload = Record<string, unknown>;

export type AudioCommand =
  | 'play'
  | 'playnow'
  | 'playnext'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'toggle'
  | 'stop'
  | 'disconnect'
  | 'volume'
  | 'loop'
  | 'loopSet'
  | 'volumeAdjust'
  | 'nowplaying'
  | 'queue'
  | 'shuffle'
  | 'clear'
  | 'remove'
  | 'move'
  | 'seek'
  | 'previous'
  | 'mute'
  | 'autoplay'
  | 'seekAdjust'
  | 'summon'
  | 'filters';

interface AudioCommandClientOptions {
  consumerNamePrefix: string;
  monitoring?: {
    onCommandEnqueued?: (stream: string) => void;
  };
}

const CONTROL_PRIORITY_COMMANDS = new Set<AudioCommand>([
  'toggle',
  'pause',
  'resume',
  'skip',
  'previous',
  'loop',
  'mute',
  'filters',
  'seekAdjust',
  'volumeAdjust',
]);

export class AudioCommandClient {
  private readonly options: AudioCommandClientOptions;
  private readonly commandsStream = RedisStreamsManager.STREAMS.AUDIO_COMMANDS;
  private readonly controlsStream = RedisStreamsManager.STREAMS.AUDIO_CONTROLS;
  private readonly responseStream = RedisStreamsManager.STREAMS.AUDIO_RESPONSES;
  private readonly consumerName: string;
  private initialized = false;

  constructor(options: AudioCommandClientOptions) {
    this.options = options;
    this.consumerName = `${options.consumerNamePrefix}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await redisStreams.connect();
    logger.info({ consumer: this.options.consumerNamePrefix }, 'Audio control redis connected');
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private resolveTargetStream(type: AudioCommand): string {
    return CONTROL_PRIORITY_COMMANDS.has(type) ? this.controlsStream : this.commandsStream;
  }

  private async enqueue(command: CommandPayload): Promise<void> {
    await this.ensureInitialized();
    const commandType = command.type as AudioCommand | undefined;
    const streamName = commandType ? this.resolveTargetStream(commandType) : this.commandsStream;
    const serialized = Object.fromEntries(
      Object.entries(command)
        .filter(([_key, value]) => value !== undefined)
        .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])
    );
    await redisStreams.addToStream(streamName, serialized);
    this.options.monitoring?.onCommandEnqueued?.(streamName);
  }

  async sendSimpleCommand(type: AudioCommand, guildId: string): Promise<string> {
    return await this.sendCommand(type, guildId);
  }

  async sendCommand(type: AudioCommand, guildId: string, payload: Record<string, unknown> = {}): Promise<string> {
    const requestId = (payload.requestId as string | undefined) ?? randomUUID();
    const priority = CONTROL_PRIORITY_COMMANDS.has(type) ? 'control' : 'normal';
    await this.enqueue({
      type,
      guildId,
      requestId,
      priority,
      enqueuedAt: Date.now(),
      timestamp: Date.now(),
      ...payload
    });
    return requestId;
  }

  async sendPlayCommand(
    mode: 'play' | 'playnow' | 'playnext',
    guildId: string,
    voiceChannelId: string,
    textChannelId: string,
    userId: string,
    query: string,
    requestId?: string
  ): Promise<string> {
    return await this.sendCommand(mode, guildId, {
      voiceChannelId,
      textChannelId,
      userId,
      query,
      requestId
    });
  }

  /**
   * Send a queue command and wait for the response from the audio service.
   * This uses the response-handlers consumer group to correlate responses by requestId.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendQueueCommand(
    guildId: string,
    options: { page?: number; timeout?: number; retries?: number }
  ): Promise<any> {
    const requestId = await this.sendCommand('queue', guildId, {
      page: options.page,
      requestId: randomUUID()
    });

    const timeoutMs = options.timeout ?? 10000;
    const startedAt = Date.now();
    const block = Math.min(1000, timeoutMs);

    while (Date.now() - startedAt < timeoutMs) {
      const messages = await redisStreams.readFromStreamGroup(
        this.responseStream,
        RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS,
        this.consumerName,
        { count: 10, block }
      );

      for (const message of messages) {
        const data = message.data as StreamResponseData;

        if (data.requestId !== requestId) {
          // Acknowledge and skip unrelated responses to prevent backlog
          await redisStreams.acknowledgeMessage(this.responseStream, RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS, message.id);
          continue;
        }

        await redisStreams.acknowledgeMessage(
          this.responseStream,
          RedisStreamsManager.CONSUMER_GROUPS.RESPONSE_HANDLERS,
          message.id
        );

        if (!data.data) {
          return null;
        }

        try {
          return JSON.parse(data.data);
        } catch {
          return data.data;
        }
      }
    }

    throw new Error('Queue request timed out');
  }
}
