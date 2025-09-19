/**
 * Input validation utilities for Discord bot
 */

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validates search queries for music playback
 */
export function validateSearchQuery(query: string): ValidationResult<string> {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Search query cannot be empty' };
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { success: false, error: 'Search query cannot be empty' };
  }

  if (trimmed.length > 1000) {
    return { success: false, error: 'Search query is too long (max 1000 characters)' };
  }

  // Check for potential script injections
  const maliciousPatterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
    /onclick=/gi,
    /eval\(/gi,
    /expression\(/gi
  ];

  for (const pattern of maliciousPatterns) {
    if (pattern.test(trimmed)) {
      return { success: false, error: 'Query contains malicious content' };
    }
  }

  // Sanitize dangerous characters while preserving URLs and music metadata
  const sanitized = trimmed
    .replace(/[<>"']/g, '') // Remove dangerous HTML chars
    .replace(/&(?![a-zA-Z0-9#]{1,6};)/g, '&'); // Keep valid entities

  return { success: true, data: sanitized };
}

/**
 * Validates integer values with optional bounds
 */
export function validateInteger(
  value: number,
  min?: number,
  max?: number
): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    return { success: false, error: 'Value must be a valid integer' };
  }

  if (min !== undefined && value < min) {
    return { success: false, error: `Value must be at least ${min}` };
  }

  if (max !== undefined && value > max) {
    return { success: false, error: `Value must be at most ${max}` };
  }

  return { success: true, data: value };
}

/**
 * Validates loop mode values
 */
export function validateLoopMode(mode: string): ValidationResult<string> {
  const validModes = ['off', 'track', 'queue'];

  if (!validModes.includes(mode)) {
    return { success: false, error: `Invalid loop mode. Must be one of: ${validModes.join(', ')}` };
  }

  return { success: true, data: mode };
}

/**
 * Validates Discord snowflake IDs
 */
export function validateSnowflake(id: string, fieldName = 'ID'): ValidationResult<string> {
  if (!id || typeof id !== 'string') {
    return { success: false, error: `${fieldName} must be provided` };
  }

  // Discord snowflakes are 17-19 digits
  const snowflakePattern = /^[0-9]{17,19}$/;

  if (!snowflakePattern.test(id)) {
    return { success: false, error: `Invalid ${fieldName} format` };
  }

  return { success: true, data: id };
}

/**
 * Validates URLs for safety
 */
export function validateURL(url: string): ValidationResult<string> {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'URL must be provided' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  // Only allow HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { success: false, error: 'Only HTTP and HTTPS URLs are allowed' };
  }

  // Block private/local networks
  const hostname = parsedUrl.hostname;
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^192\.168\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^0\.0\.0\.0$/
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      return { success: false, error: 'private network URLs are not allowed' };
    }
  }

  return { success: true, data: url };
}

/**
 * Sanitizes text for Discord display
 */
export function sanitizeDisplayText(text: string, maxLength = 256): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Escape Discord markdown and mention characters
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/@/g, '\\@')
    .replace(/#/g, '\\#');

  // Truncate if needed
  return escaped.length > maxLength ? escaped.substring(0, maxLength) : escaped;
}