import { logger } from '@discord-bot/logger';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export class TtsService {
    private logger = logger.child({ service: 'TtsService' });
    private client: TextToSpeechClient | null = null;
    private isEnabled = false;

    constructor() {
        try {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                this.client = new TextToSpeechClient();
                this.isEnabled = true;
            } else {
                this.logger.info('GOOGLE_APPLICATION_CREDENTIALS not set. TTS features remain disabled until configured.');
            }
        } catch (error) {
            this.logger.error({ error }, 'Failed to initialize Google TTS client');
        }
    }

    async synthesize(text: string): Promise<string> {
        if (!this.isEnabled || !this.client) {
            this.logger.debug('TTS disabled or not initialized. Returning mock URL.');
            return 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
        }

        try {
            const [response] = await this.client.synthesizeSpeech({
                input: { text },
                voice: { languageCode: 'en-US', ssmlGender: 'MALE', name: 'en-US-Studio-M' },
                audioConfig: { audioEncoding: 'MP3' },
            });

            if (!response.audioContent) {
                throw new Error('No audio content received from Google TTS');
            }

            // Save to temp file
            const filename = `dj-${randomUUID()}.mp3`;
            const filepath = join(tmpdir(), filename);
            // @ts-ignore - Google types can be tricky with Uint8Array vs Buffer
            await writeFile(filepath, response.audioContent, 'binary');

            this.logger.info({ filepath }, 'Synthesized speech saved to file');

            return `file://${filepath}`;

        } catch (error) {
            this.logger.error({ error }, 'Failed to synthesize speech');
            return 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'; // Fallback
        }
    }
}
