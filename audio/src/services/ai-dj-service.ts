import { logger } from '@discord-bot/logger';
import { LlmService } from './llm-service.js';
import { TtsService } from './tts-service.js';
import { subscriptionService } from '@discord-bot/database';

export class AiDjService {
    private logger = logger.child({ service: 'AiDjService' });
    private llmService: LlmService;
    private ttsService: TtsService;
    private guildCooldowns = new Map<string, number>();

    constructor(llmService: LlmService) {
        this.llmService = llmService;
        this.ttsService = new TtsService();
        this.logger.info('AiDjService initialized');
    }


    shouldInterject(guildId: string): boolean {
        const lastTime = this.guildCooldowns.get(guildId) || 0;
        const now = Date.now();
        // Interject every 3 minutes roughly, or every few songs.
        // For demo purposes, let's say 30 seconds to make it easy to verify.
        // In prod, this would be configurable.
        if (now - lastTime > 30000) {
            return true;
        }
        return false;
    }

    async generateInterjection(guildId: string, userId: string, lastTrackTitle: string, nextTrackTitle: string): Promise<string | null> {
        if (!this.shouldInterject(guildId)) {
            return null;
        }

        try {
            // Check subscription tier
            const tier = await subscriptionService.getUserTier(userId);
            if (tier !== 'DIAMOND') {
                this.logger.debug({ userId, tier }, 'Skipping AI DJ - User not DIAMOND');
                return null;
            }

            const script = await this.llmService.generateDjScript(lastTrackTitle, nextTrackTitle);
            const audioUrl = await this.ttsService.synthesize(script);

            this.guildCooldowns.set(guildId, Date.now());
            return audioUrl;
        } catch (error) {
            this.logger.error(error, 'Failed to generate DJ interjection');
            return null;
        }
    }
}

