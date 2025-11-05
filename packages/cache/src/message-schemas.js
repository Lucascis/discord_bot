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
// Schema version for future compatibility
export const SCHEMA_VERSION = 1;
/**
 * Voice Credentials Message Schema
 * Sent from Gateway to Audio service via discord-bot:to-audio channel
 */
export const VoiceCredentialsSchema = z.object({
    guildId: z.string().min(1, 'guildId is required'),
    sessionId: z.string().min(1, 'sessionId is required'),
    token: z.string().min(1, 'token is required'),
    endpoint: z.string().min(1, 'endpoint is required'),
    timestamp: z.number().optional(),
});
/**
 * Voice Credentials Message Wrapper
 * Structured format with type field
 */
export const VoiceCredentialsMessageSchema = z.object({
    type: z.literal('VOICE_CREDENTIALS'),
    guildId: z.string().min(1, 'guildId is required'),
    voiceCredentials: VoiceCredentialsSchema,
});
/**
 * Command Message Schema
 * Sent from Gateway to Audio service via discord-bot:commands channel
 * Handles all music playback commands with flexible payload structure
 */
export const CommandMessageSchema = z.union([
    // Play commands (require voice channel)
    z.object({
        type: z.enum(['play', 'playnow', 'playnext']),
        guildId: z.string().min(1, 'guildId is required'),
        voiceChannelId: z.string().min(1, 'voiceChannelId is required'),
        textChannelId: z.string().min(1, 'textChannelId is required'),
        userId: z.string().min(1, 'userId is required'),
        query: z.string().min(1, 'query is required'),
        requestId: z.string().optional(),
    }),
    // Skip command
    z.object({
        type: z.literal('skip'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Pause/Resume/Toggle commands
    z.object({
        type: z.enum(['pause', 'resume', 'toggle']),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Stop command
    z.object({
        type: z.literal('stop'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Disconnect command
    z.object({
        type: z.literal('disconnect'),
        guildId: z.string().min(1, 'guildId is required'),
        reason: z.string().optional(),
    }),
    // Volume command
    z.object({
        type: z.literal('volume'),
        guildId: z.string().min(1, 'guildId is required'),
        percent: z.number().min(0).max(200, 'Volume percent must be between 0 and 200'),
    }),
    // Loop command
    z.object({
        type: z.literal('loop'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Loop set command
    z.object({
        type: z.literal('loopSet'),
        guildId: z.string().min(1, 'guildId is required'),
        mode: z.enum(['off', 'track', 'queue']),
    }),
    // Volume adjust command
    z.object({
        type: z.literal('volumeAdjust'),
        guildId: z.string().min(1, 'guildId is required'),
        delta: z.number().int(),
    }),
    // Now playing command
    z.object({
        type: z.literal('nowplaying'),
        guildId: z.string().min(1, 'guildId is required'),
        requestId: z.string().optional(),
        channelId: z.string().optional(),
    }),
    // Queue command
    z.object({
        type: z.literal('queue'),
        guildId: z.string().min(1, 'guildId is required'),
        requestId: z.string().min(1, 'requestId is required'),
        page: z.string().optional(),
    }),
    // Seek command
    z.object({
        type: z.literal('seek'),
        guildId: z.string().min(1, 'guildId is required'),
        positionMs: z.number().int().min(0),
    }),
    // Seek adjust command
    z.object({
        type: z.literal('seekAdjust'),
        guildId: z.string().min(1, 'guildId is required'),
        deltaMs: z.number().int(),
    }),
    // Shuffle command
    z.object({
        type: z.literal('shuffle'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Remove command
    z.object({
        type: z.literal('remove'),
        guildId: z.string().min(1, 'guildId is required'),
        index: z.number().int().min(0),
    }),
    // Clear command
    z.object({
        type: z.literal('clear'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Move command
    z.object({
        type: z.literal('move'),
        guildId: z.string().min(1, 'guildId is required'),
        from: z.number().int().min(0),
        to: z.number().int().min(0),
    }),
    // Seed related command
    z.object({
        type: z.literal('seedRelated'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Previous command
    z.object({
        type: z.literal('previous'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Mute command
    z.object({
        type: z.literal('mute'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Filters command
    z.object({
        type: z.literal('filters'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
    // Autoplay command
    z.object({
        type: z.literal('autoplay'),
        guildId: z.string().min(1, 'guildId is required'),
    }),
]);
/**
 * Lavalink Event Message Schema
 * Sent from Audio service to Gateway via discord-bot:to-discord channel
 */
export const LavalinkEventMessageSchema = z.object({
    guildId: z.string().min(1, 'guildId is required'),
    payload: z.object({
        op: z.union([z.number(), z.string()]),
    }).passthrough(), // Allow additional fields from Lavalink
});
/**
 * UI Update Message Schema
 * Sent from Audio service to Gateway via discord-bot:ui:now channel
 * Used for real-time UI updates to now-playing displays
 */
export const UIUpdateMessageSchema = z.object({
    guildId: z.string().min(1, 'guildId is required'),
    textChannelId: z.string().min(1, 'textChannelId is required'),
    type: z.string(),
    payload: z.object({
        op: z.union([z.number(), z.string()]),
        track: z.object({
            title: z.string(),
            artist: z.string(),
            duration: z.number().int().min(0),
            thumbnail: z.string().optional(),
            uri: z.string().optional(),
        }).optional(),
        queuePosition: z.number().int().min(0).optional(),
        requestedBy: z.string().optional(),
    }).passthrough(), // Allow additional fields
    timestamp: z.number().optional(),
});
/**
 * Track Queued Event Message
 * Special message for track queued notifications
 */
export const TrackQueuedMessageSchema = z.object({
    type: z.literal('track_queued'),
    guildId: z.string().min(1, 'guildId is required'),
    textChannelId: z.string().min(1, 'textChannelId is required'),
    payload: z.object({
        op: z.string(),
        track: z.object({
            title: z.string(),
            artist: z.string(),
            duration: z.number().int().min(0),
            thumbnail: z.string().optional(),
        }),
        queuePosition: z.number().int().min(0),
        requestedBy: z.string().min(1),
    }),
});
/**
 * Discord Event Message Schema
 * Handles raw Discord events (VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE, etc.)
 */
export const DiscordEventMessageSchema = z.object({
    type: z.string(),
    guildId: z.string().optional(),
}).passthrough(); // Allow any additional properties
/**
 * Generic payload validation schema
 * Used for parsing unknown message types
 */
export const GenericMessageSchema = z.object({}).passthrough();
/**
 * Validation Functions
 */
/**
 * Validates voice credentials message
 * @throws ZodError if validation fails
 */
export function validateVoiceCredentials(data) {
    return VoiceCredentialsSchema.parse(data);
}
/**
 * Safely validates voice credentials message
 * @returns { success: true, data } or { success: false, error }
 */
export function safeValidateVoiceCredentials(data) {
    try {
        return { success: true, data: VoiceCredentialsSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Validates voice credentials message wrapper
 * @throws ZodError if validation fails
 */
export function validateVoiceCredentialsMessage(data) {
    return VoiceCredentialsMessageSchema.parse(data);
}
/**
 * Safely validates voice credentials message wrapper
 */
export function safeValidateVoiceCredentialsMessage(data) {
    try {
        return { success: true, data: VoiceCredentialsMessageSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Validates command message
 * @throws ZodError if validation fails
 */
export function validateCommand(data) {
    return CommandMessageSchema.parse(data);
}
/**
 * Safely validates command message
 */
export function safeValidateCommand(data) {
    try {
        return { success: true, data: CommandMessageSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Validates Lavalink event message
 * @throws ZodError if validation fails
 */
export function validateLavalinkEvent(data) {
    return LavalinkEventMessageSchema.parse(data);
}
/**
 * Safely validates Lavalink event message
 */
export function safeValidateLavalinkEvent(data) {
    try {
        return { success: true, data: LavalinkEventMessageSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Validates UI update message
 * @throws ZodError if validation fails
 */
export function validateUIUpdate(data) {
    return UIUpdateMessageSchema.parse(data);
}
/**
 * Safely validates UI update message
 */
export function safeValidateUIUpdate(data) {
    try {
        return { success: true, data: UIUpdateMessageSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Validates track queued message
 * @throws ZodError if validation fails
 */
export function validateTrackQueued(data) {
    return TrackQueuedMessageSchema.parse(data);
}
/**
 * Safely validates track queued message
 */
export function safeValidateTrackQueued(data) {
    try {
        return { success: true, data: TrackQueuedMessageSchema.parse(data) };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
/**
 * Generic message validator
 * Attempts to identify message type and validate accordingly
 */
export function validateMessage(data) {
    if (typeof data !== 'object' || data === null) {
        throw new Error('Message must be an object');
    }
    const obj = data;
    const type = obj.type;
    // Try type-specific validators
    if (type === 'VOICE_CREDENTIALS' && obj.voiceCredentials) {
        return { type: 'voice_credentials_message', data: validateVoiceCredentialsMessage(data) };
    }
    if (typeof type === 'string' && ['play', 'playnow', 'playnext', 'skip', 'pause', 'resume', 'toggle', 'stop', 'disconnect', 'volume', 'loop', 'loopSet', 'volumeAdjust', 'nowplaying', 'queue', 'seek', 'seekAdjust', 'shuffle', 'remove', 'clear', 'move', 'seedRelated', 'previous', 'mute', 'filters', 'autoplay'].includes(type)) {
        return { type: 'command', data: validateCommand(data) };
    }
    if (obj.guildId && obj.payload && typeof obj.payload === 'object' && 'op' in obj.payload) {
        return { type: 'lavalink_event', data: validateLavalinkEvent(data) };
    }
    // Fallback to generic validation
    return { type: 'generic', data: GenericMessageSchema.parse(data) };
}
/**
 * Safely validates any message type
 */
export function safeValidateMessage(data) {
    try {
        const result = validateMessage(data);
        return { success: true, type: result.type, data: result.data };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
            details: error,
        };
    }
}
