export interface AudioCommandClientOptions {
    consumerNamePrefix?: string;
    monitoring?: {
        onCommandEnqueued?: (stream: string) => void;
    };
    responseBatchSize?: number;
    responseBlockMs?: number;
}
export interface AudioCommandOptions {
    timeout?: number;
    retries?: number;
}
export interface QueueCommandResult {
    items: Array<{
        title: string;
        uri?: string;
    }>;
    page: number;
    totalPages: number;
    totalTracks: number;
}
export declare class AudioCommandClient {
    private readonly options;
    private responseHandlers;
    private consumerName;
    private isInitialized;
    constructor(options?: AudioCommandClientOptions);
    initialize(): Promise<void>;
    sendQueueCommand(guildId: string, options?: AudioCommandOptions & {
        page?: number;
    }): Promise<QueueCommandResult>;
    sendNowPlayingCommand(guildId: string, textChannelId?: string): Promise<void>;
    sendSimpleCommand(type: 'skip' | 'pause' | 'resume' | 'toggle' | 'stop' | 'shuffle' | 'clear' | 'previous' | 'mute', guildId: string): Promise<void>;
    sendCommand(type: string, guildId: string, additionalData?: Record<string, string>, options?: AudioCommandOptions): Promise<any>;
    sendPlayCommand(type: 'play' | 'playnow' | 'playnext', guildId: string, voiceChannelId: string, textChannelId: string, userId: string, query: string, options?: AudioCommandOptions): Promise<void>;
    getStats(): {
        pendingRequests: number;
        isInitialized: boolean;
        consumerName: string;
    };
    shutdown(): Promise<void>;
    private sendCommandOnly;
    private sendCommandWithResponse;
    private attemptCommand;
    private handleResponse;
}
//# sourceMappingURL=audio-command-client.d.ts.map