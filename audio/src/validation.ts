export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validates search query for audio system
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

  // Check for suspicious patterns that could be injection attempts
  const suspiciousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /eval\s*\(/gi,
    /expression\s*\(/gi
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { success: false, error: 'Query contains potentially malicious content' };
    }
  }

  // Remove control characters and sanitize
  const sanitized = trimmed
    .replace(/[<>'"]/g, '') // Remove HTML/script injection chars
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
    .slice(0, 1000); // Ensure length limit

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

/**
 * Validates command message structure
 */
export function validateCommandMessage(data: any): ValidationResult<any> {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Invalid command data' };
  }

  if (!data.type || typeof data.type !== 'string') {
    return { success: false, error: 'Command type is required' };
  }

  const validTypes = [
    'play', 'skip', 'pause', 'resume', 'toggle', 'stop', 'volume', 'loop',
    'loopSet', 'volumeAdjust', 'nowplaying', 'queue', 'seek', 'seekAdjust',
    'shuffle', 'remove', 'clear', 'move', 'seedRelated'
  ];

  if (!validTypes.includes(data.type)) {
    return { success: false, error: `Unknown command type: ${data.type}` };
  }

  if (!data.guildId || typeof data.guildId !== 'string') {
    return { success: false, error: 'Guild ID is required' };
  }

  const guildValidation = validateSnowflake(data.guildId, 'Guild ID');
  if (!guildValidation.success) {
    return guildValidation;
  }

  // Validate specific command types
  if (data.type === 'play') {
    if (!data.query || typeof data.query !== 'string') {
      return { success: false, error: 'Query is required for play command' };
    }

    if (!data.voiceChannelId || typeof data.voiceChannelId !== 'string') {
      return { success: false, error: 'Voice channel ID is required for play command' };
    }

    if (!data.textChannelId || typeof data.textChannelId !== 'string') {
      return { success: false, error: 'Text channel ID is required for play command' };
    }

    if (!data.userId || typeof data.userId !== 'string') {
      return { success: false, error: 'User ID is required for play command' };
    }

    const queryValidation = validateSearchQuery(data.query);
    if (!queryValidation.success) {
      return queryValidation;
    }

    data.query = queryValidation.data;

    // Validate channel IDs
    const voiceValidation = validateSnowflake(data.voiceChannelId, 'Voice Channel ID');
    if (!voiceValidation.success) return voiceValidation;

    const textValidation = validateSnowflake(data.textChannelId, 'Text Channel ID');
    if (!textValidation.success) return textValidation;

    const userValidation = validateSnowflake(data.userId, 'User ID');
    if (!userValidation.success) return userValidation;
  }

  if (data.type === 'volume') {
    if (typeof data.percent !== 'number' || !Number.isInteger(data.percent)) {
      return { success: false, error: 'Volume percent must be an integer' };
    }
    if (data.percent < 0 || data.percent > 200) {
      return { success: false, error: 'Volume percent must be between 0 and 200' };
    }
  }

  if (data.type === 'loopSet') {
    if (!data.mode || typeof data.mode !== 'string') {
      return { success: false, error: 'Loop mode is required' };
    }
    if (!['off', 'track', 'queue'].includes(data.mode)) {
      return { success: false, error: 'Invalid loop mode. Must be one of: off, track, queue' };
    }
  }

  if (data.type === 'volumeAdjust') {
    if (typeof data.delta !== 'number' || !Number.isInteger(data.delta)) {
      return { success: false, error: 'Volume delta must be an integer' };
    }
  }

  if (data.type === 'seek') {
    if (typeof data.positionMs !== 'number' || !Number.isInteger(data.positionMs)) {
      return { success: false, error: 'Position in milliseconds must be an integer' };
    }
    if (data.positionMs < 0) {
      return { success: false, error: 'Position must be non-negative' };
    }
  }

  if (data.type === 'seekAdjust') {
    if (typeof data.deltaMs !== 'number' || !Number.isInteger(data.deltaMs)) {
      return { success: false, error: 'Delta in milliseconds must be an integer' };
    }
  }

  if (data.type === 'remove') {
    if (typeof data.index !== 'number' || !Number.isInteger(data.index)) {
      return { success: false, error: 'Index must be an integer' };
    }
    if (data.index < 1) {
      return { success: false, error: 'Index must be at least 1' };
    }
  }

  if (data.type === 'move') {
    if (typeof data.from !== 'number' || !Number.isInteger(data.from)) {
      return { success: false, error: 'From index must be an integer' };
    }
    if (typeof data.to !== 'number' || !Number.isInteger(data.to)) {
      return { success: false, error: 'To index must be an integer' };
    }
    if (data.from < 1 || data.to < 1) {
      return { success: false, error: 'Indices must be at least 1' };
    }
  }

  if (['nowplaying', 'queue'].includes(data.type)) {
    if (!data.requestId || typeof data.requestId !== 'string') {
      return { success: false, error: 'Request ID is required for this command' };
    }
  }

  return { success: true, data };
}