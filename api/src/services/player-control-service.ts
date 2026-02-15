import { AudioCommandClient } from '@discord-bot/audio-control';
import { RedisStreamsManager } from '@discord-bot/cache';
import { logger } from '@discord-bot/logger';

export const playerAudioClient = new AudioCommandClient({
    consumerNamePrefix: 'api',
    monitoring: {
        onCommandEnqueued: (stream) => {
            if (
                stream === RedisStreamsManager.STREAMS.AUDIO_COMMANDS ||
                stream === RedisStreamsManager.STREAMS.AUDIO_CONTROLS
            ) {
                logger.debug({ stream }, 'API enqueued command for audio service');
            }
        }
    }
});

if (process.env.NODE_ENV !== 'test') {
    void playerAudioClient.initialize().catch((error) => {
        logger.error({ error }, 'Failed to initialize audio command client for API');
    });
}
