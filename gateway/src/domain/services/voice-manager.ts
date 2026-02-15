import { logger } from '@discord-bot/logger';

export class VoiceManager {
    // Voice Server Data Storage (for token and endpoint)
    private voiceServerData: Map<string, { token: string; endpoint: string; processedAt?: number }> = new Map();
    // Voice State Data Storage (for sessionId and channel)
    private voiceStateData: Map<string, { sessionId: string; channelId: string | null; processedAt?: number }> = new Map();

    public setVoiceServerData(guildId: string, token: string, endpoint: string): void {
        this.voiceServerData.set(guildId, {
            token,
            endpoint,
            processedAt: Date.now()
        });
        logger.debug({ guildId }, 'Voice server data updated');
    }

    public getVoiceServerData(guildId: string): { token: string; endpoint: string; processedAt?: number } | undefined {
        return this.voiceServerData.get(guildId);
    }

    public clearVoiceServerData(guildId: string): void {
        this.voiceServerData.delete(guildId);
    }

    public hasVoiceServerData(guildId: string): boolean {
        return this.voiceServerData.has(guildId);
    }

    public setVoiceStateData(guildId: string, sessionId: string, channelId: string | null): void {
        this.voiceStateData.set(guildId, {
            sessionId,
            channelId,
            processedAt: Date.now()
        });
        logger.debug({ guildId }, 'Voice state data updated');
    }

    public getVoiceStateData(guildId: string): { sessionId: string; channelId: string | null; processedAt?: number } | undefined {
        return this.voiceStateData.get(guildId);
    }

    public clearVoiceStateData(guildId: string): void {
        this.voiceStateData.delete(guildId);
    }
}
