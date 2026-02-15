import { AudioCommandClient } from '@discord-bot/audio-control';
import { gatewayStreamsMonitoring, RedisStreamsManager } from '@discord-bot/cache';

export class AudioCommandService extends AudioCommandClient {
  constructor() {
    super({
      consumerNamePrefix: 'gateway',
      monitoring: {
        onCommandEnqueued: (streamName) => {
          if (
            streamName === RedisStreamsManager.STREAMS.AUDIO_COMMANDS ||
            streamName === RedisStreamsManager.STREAMS.AUDIO_CONTROLS
          ) {
            gatewayStreamsMonitoring.recordMessageAdded(streamName);
          }
        }
      }
    });
  }
}

export const audioCommandService = new AudioCommandService();
