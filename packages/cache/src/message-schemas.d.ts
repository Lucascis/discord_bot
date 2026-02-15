/**
 * Redis Pub/Sub Message Validation Schemas
 *
 * Provides Zod schemas for all inter-service message types to prevent errors
 * from malformed or type-mismatched messages. Each schema validates the
 * message structure before processing.
 *
 * Message Channels:
 * - discord-bot:commands - Gateway -> Audio (music playback commands)
 * - discord-bot:to-audio - Gateway -> Audio (Discord voice events & credentials)
 * - discord-bot:to-discord - Audio -> Gateway (Lavalink events)
 * - discord-bot:ui:now - Audio -> Gateway (real-time UI updates)
 */
import { z } from 'zod';
export declare const SCHEMA_VERSION = 1;
/**
 * Voice Credentials Message Schema
 * Sent from Gateway to Audio service via discord-bot:to-audio channel
 */
export declare const VoiceCredentialsSchema: z.ZodObject<{
    guildId: z.ZodString;
    sessionId: z.ZodString;
    token: z.ZodString;
    endpoint: z.ZodString;
    timestamp: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    sessionId: string;
    token: string;
    endpoint: string;
    timestamp?: number | undefined;
}, {
    guildId: string;
    sessionId: string;
    token: string;
    endpoint: string;
    timestamp?: number | undefined;
}>;
export type VoiceCredentials = z.infer<typeof VoiceCredentialsSchema>;
/**
 * Voice Credentials Message Wrapper
 * Structured format with type field
 */
export declare const VoiceCredentialsMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"VOICE_CREDENTIALS">;
    guildId: z.ZodString;
    voiceCredentials: z.ZodObject<{
        guildId: z.ZodString;
        sessionId: z.ZodString;
        token: z.ZodString;
        endpoint: z.ZodString;
        timestamp: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        guildId: string;
        sessionId: string;
        token: string;
        endpoint: string;
        timestamp?: number | undefined;
    }, {
        guildId: string;
        sessionId: string;
        token: string;
        endpoint: string;
        timestamp?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "VOICE_CREDENTIALS";
    voiceCredentials: {
        guildId: string;
        sessionId: string;
        token: string;
        endpoint: string;
        timestamp?: number | undefined;
    };
}, {
    guildId: string;
    type: "VOICE_CREDENTIALS";
    voiceCredentials: {
        guildId: string;
        sessionId: string;
        token: string;
        endpoint: string;
        timestamp?: number | undefined;
    };
}>;
export type VoiceCredentialsMessage = z.infer<typeof VoiceCredentialsMessageSchema>;
/**
 * Command Message Schema
 * Sent from Gateway to Audio service via discord-bot:commands channel
 * Handles all music playback commands with flexible payload structure
 */
export declare const CommandMessageSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodEnum<["play", "playnow", "playnext"]>;
    guildId: z.ZodString;
    voiceChannelId: z.ZodString;
    textChannelId: z.ZodString;
    userId: z.ZodString;
    query: z.ZodString;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "play" | "playnow" | "playnext";
    query: string;
    voiceChannelId: string;
    textChannelId: string;
    userId: string;
    requestId?: string | undefined;
}, {
    guildId: string;
    type: "play" | "playnow" | "playnext";
    query: string;
    voiceChannelId: string;
    textChannelId: string;
    userId: string;
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"skip">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "skip";
}, {
    guildId: string;
    type: "skip";
}>, z.ZodObject<{
    type: z.ZodEnum<["pause", "resume", "toggle"]>;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "toggle" | "pause" | "resume";
}, {
    guildId: string;
    type: "toggle" | "pause" | "resume";
}>, z.ZodObject<{
    type: z.ZodLiteral<"stop">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "stop";
}, {
    guildId: string;
    type: "stop";
}>, z.ZodObject<{
    type: z.ZodLiteral<"disconnect">;
    guildId: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "disconnect";
    reason?: string | undefined;
}, {
    guildId: string;
    type: "disconnect";
    reason?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"volume">;
    guildId: z.ZodString;
    percent: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "volume";
    percent: number;
}, {
    guildId: string;
    type: "volume";
    percent: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"loop">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "loop";
}, {
    guildId: string;
    type: "loop";
}>, z.ZodObject<{
    type: z.ZodLiteral<"loopSet">;
    guildId: z.ZodString;
    mode: z.ZodEnum<["off", "track", "queue"]>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "loopSet";
    mode: "queue" | "off" | "track";
}, {
    guildId: string;
    type: "loopSet";
    mode: "queue" | "off" | "track";
}>, z.ZodObject<{
    type: z.ZodLiteral<"volumeAdjust">;
    guildId: z.ZodString;
    delta: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "volumeAdjust";
    delta: number;
}, {
    guildId: string;
    type: "volumeAdjust";
    delta: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"nowplaying">;
    guildId: z.ZodString;
    requestId: z.ZodOptional<z.ZodString>;
    channelId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "nowplaying";
    requestId?: string | undefined;
    channelId?: string | undefined;
}, {
    guildId: string;
    type: "nowplaying";
    requestId?: string | undefined;
    channelId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"queue">;
    guildId: z.ZodString;
    requestId: z.ZodString;
    page: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "queue";
    requestId: string;
    page?: string | undefined;
}, {
    guildId: string;
    type: "queue";
    requestId: string;
    page?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"seek">;
    guildId: z.ZodString;
    positionMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "seek";
    positionMs: number;
}, {
    guildId: string;
    type: "seek";
    positionMs: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"seekAdjust">;
    guildId: z.ZodString;
    deltaMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "seekAdjust";
    deltaMs: number;
}, {
    guildId: string;
    type: "seekAdjust";
    deltaMs: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"shuffle">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "shuffle";
}, {
    guildId: string;
    type: "shuffle";
}>, z.ZodObject<{
    type: z.ZodLiteral<"remove">;
    guildId: z.ZodString;
    index: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "remove";
    index: number;
}, {
    guildId: string;
    type: "remove";
    index: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"clear">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "clear";
}, {
    guildId: string;
    type: "clear";
}>, z.ZodObject<{
    type: z.ZodLiteral<"move">;
    guildId: z.ZodString;
    from: z.ZodNumber;
    to: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "move";
    from: number;
    to: number;
}, {
    guildId: string;
    type: "move";
    from: number;
    to: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"seedRelated">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "seedRelated";
}, {
    guildId: string;
    type: "seedRelated";
}>, z.ZodObject<{
    type: z.ZodLiteral<"previous">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "previous";
}, {
    guildId: string;
    type: "previous";
}>, z.ZodObject<{
    type: z.ZodLiteral<"mute">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "mute";
}, {
    guildId: string;
    type: "mute";
}>, z.ZodObject<{
    type: z.ZodLiteral<"summon">;
    guildId: z.ZodString;
    voiceChannelId: z.ZodString;
    textChannelId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "summon";
    voiceChannelId: string;
    textChannelId: string;
}, {
    guildId: string;
    type: "summon";
    voiceChannelId: string;
    textChannelId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"filters">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "filters";
}, {
    guildId: string;
    type: "filters";
}>, z.ZodObject<{
    type: z.ZodLiteral<"autoplay">;
    guildId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "autoplay";
}, {
    guildId: string;
    type: "autoplay";
}>]>;
export type CommandMessage = z.infer<typeof CommandMessageSchema>;
/**
 * Lavalink Event Message Schema
 * Sent from Audio service to Gateway via discord-bot:to-discord channel
 */
export declare const LavalinkEventMessageSchema: z.ZodObject<{
    guildId: z.ZodString;
    payload: z.ZodObject<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    }, z.ZodTypeAny, "passthrough">>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    payload: {
        op: string | number;
    } & {
        [k: string]: unknown;
    };
}, {
    guildId: string;
    payload: {
        op: string | number;
    } & {
        [k: string]: unknown;
    };
}>;
export type LavalinkEventMessage = z.infer<typeof LavalinkEventMessageSchema>;
/**
 * UI Update Message Schema
 * Sent from Audio service to Gateway via discord-bot:ui:now channel
 * Used for real-time UI updates to now-playing displays
 */
export declare const UIUpdateMessageSchema: z.ZodObject<{
    guildId: z.ZodString;
    textChannelId: z.ZodString;
    type: z.ZodString;
    payload: z.ZodObject<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
        track: z.ZodOptional<z.ZodObject<{
            title: z.ZodString;
            artist: z.ZodString;
            duration: z.ZodNumber;
            thumbnail: z.ZodOptional<z.ZodString>;
            uri: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }>>;
        queuePosition: z.ZodOptional<z.ZodNumber>;
        requestedBy: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
        track: z.ZodOptional<z.ZodObject<{
            title: z.ZodString;
            artist: z.ZodString;
            duration: z.ZodNumber;
            thumbnail: z.ZodOptional<z.ZodString>;
            uri: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }>>;
        queuePosition: z.ZodOptional<z.ZodNumber>;
        requestedBy: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        op: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
        track: z.ZodOptional<z.ZodObject<{
            title: z.ZodString;
            artist: z.ZodString;
            duration: z.ZodNumber;
            thumbnail: z.ZodOptional<z.ZodString>;
            uri: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        }>>;
        queuePosition: z.ZodOptional<z.ZodNumber>;
        requestedBy: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    timestamp: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: string;
    textChannelId: string;
    payload: {
        op: string | number;
        track?: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        } | undefined;
        queuePosition?: number | undefined;
        requestedBy?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    timestamp?: number | undefined;
}, {
    guildId: string;
    type: string;
    textChannelId: string;
    payload: {
        op: string | number;
        track?: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
            uri?: string | undefined;
        } | undefined;
        queuePosition?: number | undefined;
        requestedBy?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    timestamp?: number | undefined;
}>;
export type UIUpdateMessage = z.infer<typeof UIUpdateMessageSchema>;
/**
 * Track Queued Event Message
 * Special message for track queued notifications
 */
export declare const TrackQueuedMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"track_queued">;
    guildId: z.ZodString;
    textChannelId: z.ZodString;
    payload: z.ZodObject<{
        op: z.ZodString;
        track: z.ZodObject<{
            title: z.ZodString;
            artist: z.ZodString;
            duration: z.ZodNumber;
            thumbnail: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        }, {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        }>;
        queuePosition: z.ZodNumber;
        requestedBy: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        op: string;
        track: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        };
        queuePosition: number;
        requestedBy: string;
    }, {
        op: string;
        track: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        };
        queuePosition: number;
        requestedBy: string;
    }>;
}, "strip", z.ZodTypeAny, {
    guildId: string;
    type: "track_queued";
    textChannelId: string;
    payload: {
        op: string;
        track: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        };
        queuePosition: number;
        requestedBy: string;
    };
}, {
    guildId: string;
    type: "track_queued";
    textChannelId: string;
    payload: {
        op: string;
        track: {
            title: string;
            artist: string;
            duration: number;
            thumbnail?: string | undefined;
        };
        queuePosition: number;
        requestedBy: string;
    };
}>;
export type TrackQueuedMessage = z.infer<typeof TrackQueuedMessageSchema>;
/**
 * Discord Event Message Schema
 * Handles raw Discord events (VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE, etc.)
 */
export declare const DiscordEventMessageSchema: z.ZodObject<{
    type: z.ZodString;
    guildId: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    type: z.ZodString;
    guildId: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    type: z.ZodString;
    guildId: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type DiscordEventMessage = z.infer<typeof DiscordEventMessageSchema>;
/**
 * Generic payload validation schema
 * Used for parsing unknown message types
 */
export declare const GenericMessageSchema: z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>;
export type GenericMessage = z.infer<typeof GenericMessageSchema>;
/**
 * Validation Functions
 */
/**
 * Validates voice credentials message
 * @throws ZodError if validation fails
 */
export declare function validateVoiceCredentials(data: unknown): VoiceCredentials;
/**
 * Safely validates voice credentials message
 * @returns { success: true, data } or { success: false, error }
 */
export declare function safeValidateVoiceCredentials(data: unknown): {
    success: true;
    data: VoiceCredentials;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Validates voice credentials message wrapper
 * @throws ZodError if validation fails
 */
export declare function validateVoiceCredentialsMessage(data: unknown): VoiceCredentialsMessage;
/**
 * Safely validates voice credentials message wrapper
 */
export declare function safeValidateVoiceCredentialsMessage(data: unknown): {
    success: true;
    data: VoiceCredentialsMessage;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Validates command message
 * @throws ZodError if validation fails
 */
export declare function validateCommand(data: unknown): CommandMessage;
/**
 * Safely validates command message
 */
export declare function safeValidateCommand(data: unknown): {
    success: true;
    data: CommandMessage;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Validates Lavalink event message
 * @throws ZodError if validation fails
 */
export declare function validateLavalinkEvent(data: unknown): LavalinkEventMessage;
/**
 * Safely validates Lavalink event message
 */
export declare function safeValidateLavalinkEvent(data: unknown): {
    success: true;
    data: LavalinkEventMessage;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Validates UI update message
 * @throws ZodError if validation fails
 */
export declare function validateUIUpdate(data: unknown): UIUpdateMessage;
/**
 * Safely validates UI update message
 */
export declare function safeValidateUIUpdate(data: unknown): {
    success: true;
    data: UIUpdateMessage;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Validates track queued message
 * @throws ZodError if validation fails
 */
export declare function validateTrackQueued(data: unknown): TrackQueuedMessage;
/**
 * Safely validates track queued message
 */
export declare function safeValidateTrackQueued(data: unknown): {
    success: true;
    data: TrackQueuedMessage;
} | {
    success: false;
    error: string;
    details?: unknown;
};
/**
 * Generic message validator
 * Attempts to identify message type and validate accordingly
 */
export declare function validateMessage(data: unknown): {
    type: string;
    data: unknown;
};
/**
 * Safely validates any message type
 */
export declare function safeValidateMessage(data: unknown): {
    success: true;
    type: string;
    data: unknown;
} | {
    success: false;
    error: string;
    details?: unknown;
};
//# sourceMappingURL=message-schemas.d.ts.map