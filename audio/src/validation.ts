export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validates and sanitizes search query for audio system
 * Focuses on preventing XSS and obvious injection attempts while preserving music search functionality
 */
export function validateSearchQuery(query: string): ValidationResult<string> {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Query must be a non-empty string' };
  }

  const trimmed = query.trim();
  
  if (trimmed.length === 0) {
    return { success: false, error: 'Query cannot be empty' };
  }

  if (trimmed.length > 1000) {
    return { success: false, error: 'Query too long (max 1000 characters)' };
  }

  // Focus on the most critical security patterns for music bot context
  const suspiciousPatterns = [
    // XSS and script injection (most important for a Discord bot)
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /on\w+\s*=/gi,
    
    // Command injection (obvious cases)
    /;\s*(rm|del|format|shutdown|reboot)/gi,
    /\|\s*(nc|netcat|curl|wget|bash|sh|cmd)/gi,
    
    // Null bytes (always malicious)
    /\x00/gi,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { success: false, error: 'Query contains potentially malicious content' };
    }
  }

  // Light sanitization that preserves most music-related content
  let sanitized = trimmed
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove null bytes and other dangerous control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Final length check after sanitization
  if (sanitized.length === 0) {
    return { success: false, error: 'Query becomes empty after sanitization' };
  }

  // Ensure final length limit
  sanitized = sanitized.slice(0, 1000);

  return { success: true, data: sanitized };
}

/**
 * Validates Discord snowflake IDs
 */
export function validateSnowflake(id: string | null | undefined, name = 'ID'): ValidationResult<string> {
  if (!id || typeof id !== 'string') {
    return { success: false, error: `${name} is required` };
  }

  if (!/^\d{17,19}$/.test(id)) {
    return { success: false, error: `Invalid ${name} format` };
  }

  return { success: true, data: id };
}

// Interface for command message structure
export interface CommandMessage {
  type: string;
  guildId: string;
  query?: string;
  voiceChannelId?: string;
  textChannelId?: string;
  userId?: string;
  percent?: number;
  mode?: string;
  delta?: number;
  positionMs?: number;
  deltaMs?: number;
  index?: number;
  from?: number;
  to?: number;
  requestId?: string;
}

/**
 * Validates command message structure
 */
export function validateCommandMessage(data: unknown): ValidationResult<CommandMessage> {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Invalid command data' };
  }

  const msg = data as Record<string, unknown>;

  if (!msg.type || typeof msg.type !== 'string') {
    return { success: false, error: 'Command type is required' };
  }

  const validTypes = [
    'play', 'skip', 'pause', 'resume', 'toggle', 'stop', 'volume', 'loop',
    'loopSet', 'volumeAdjust', 'nowplaying', 'queue', 'seek', 'seekAdjust',
    'shuffle', 'remove', 'clear', 'move', 'seedRelated'
  ];

  if (!validTypes.includes(msg.type)) {
    return { success: false, error: `Unknown command type: ${msg.type}` };
  }

  if (!msg.guildId || typeof msg.guildId !== 'string') {
    return { success: false, error: 'Guild ID is required' };
  }

  const guildValidation = validateSnowflake(msg.guildId, 'Guild ID');
  if (!guildValidation.success) {
    return { success: false, error: guildValidation.error || 'Invalid guild ID' };
  }

  // Validate specific command types
  if (msg.type === 'play') {
    if (!msg.query || typeof msg.query !== 'string') {
      return { success: false, error: 'Query is required for play command' };
    }

    if (!msg.voiceChannelId || typeof msg.voiceChannelId !== 'string') {
      return { success: false, error: 'Voice channel ID is required for play command' };
    }

    if (!msg.textChannelId || typeof msg.textChannelId !== 'string') {
      return { success: false, error: 'Text channel ID is required for play command' };
    }

    if (!msg.userId || typeof msg.userId !== 'string') {
      return { success: false, error: 'User ID is required for play command' };
    }

    const queryValidation = validateSearchQuery(msg.query);
    if (!queryValidation.success) {
      return { success: false, error: queryValidation.error || 'Invalid query' };
    }

    msg.query = queryValidation.data;

    // Validate channel IDs
    const voiceValidation = validateSnowflake(msg.voiceChannelId, 'Voice Channel ID');
    if (!voiceValidation.success) return { success: false, error: voiceValidation.error || 'Invalid voice channel ID' };

    const textValidation = validateSnowflake(msg.textChannelId, 'Text Channel ID');
    if (!textValidation.success) return { success: false, error: textValidation.error || 'Invalid text channel ID' };

    const userValidation = validateSnowflake(msg.userId, 'User ID');
    if (!userValidation.success) return { success: false, error: userValidation.error || 'Invalid user ID' };
  }

  if (msg.type === 'volume') {
    if (typeof msg.percent !== 'number' || !Number.isInteger(msg.percent)) {
      return { success: false, error: 'Volume percent must be an integer' };
    }
    if (msg.percent < 0 || msg.percent > 200) {
      return { success: false, error: 'Volume percent must be between 0 and 200' };
    }
  }

  if (msg.type === 'loopSet') {
    if (!msg.mode || typeof msg.mode !== 'string') {
      return { success: false, error: 'Loop mode is required' };
    }
    if (!['off', 'track', 'queue'].includes(msg.mode)) {
      return { success: false, error: 'Invalid loop mode. Must be one of: off, track, queue' };
    }
  }

  if (msg.type === 'volumeAdjust') {
    if (typeof msg.delta !== 'number' || !Number.isInteger(msg.delta)) {
      return { success: false, error: 'Volume delta must be an integer' };
    }
  }

  if (msg.type === 'seek') {
    if (typeof msg.positionMs !== 'number' || !Number.isInteger(msg.positionMs)) {
      return { success: false, error: 'Position in milliseconds must be an integer' };
    }
    if (msg.positionMs < 0) {
      return { success: false, error: 'Position must be non-negative' };
    }
  }

  if (msg.type === 'seekAdjust') {
    if (typeof msg.deltaMs !== 'number' || !Number.isInteger(msg.deltaMs)) {
      return { success: false, error: 'Delta in milliseconds must be an integer' };
    }
  }

  if (msg.type === 'remove') {
    if (typeof msg.index !== 'number' || !Number.isInteger(msg.index)) {
      return { success: false, error: 'Index must be an integer' };
    }
    if (msg.index < 1) {
      return { success: false, error: 'Index must be at least 1' };
    }
  }

  if (msg.type === 'move') {
    if (typeof msg.from !== 'number' || !Number.isInteger(msg.from)) {
      return { success: false, error: 'From index must be an integer' };
    }
    if (typeof msg.to !== 'number' || !Number.isInteger(msg.to)) {
      return { success: false, error: 'To index must be an integer' };
    }
    if (msg.from < 1 || msg.to < 1) {
      return { success: false, error: 'Indices must be at least 1' };
    }
  }

  if (['nowplaying', 'queue'].includes(msg.type)) {
    if (!msg.requestId || typeof msg.requestId !== 'string') {
      return { success: false, error: 'Request ID is required for this command' };
    }
  }

  return { success: true, data: msg as unknown as CommandMessage };
}