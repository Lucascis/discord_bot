import { logger } from '@discord-bot/logger';
import { randomUUID } from 'crypto';

export class SecurityError extends Error {
  constructor(message: string, public readonly code: string = 'SECURITY_ERROR') {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Secure header manager for protecting credentials in HTTP requests
 */
export class SecureHeaderManager {
  private readonly credentials: Map<string, string> = new Map();

  constructor() {
    // Store credentials securely at startup
    this.credentials.set('lavalink', process.env.LAVALINK_PASSWORD || '');
  }

  /**
   * Get secure headers for HTTP requests without exposing credentials in logs
   */
  getSecureHeaders(service: 'lavalink'): Record<string, string> {
    const credential = this.credentials.get(service);
    if (!credential) {
      throw new SecurityError(`No credential found for service: ${service}`, 'CREDENTIAL_NOT_FOUND');
    }

    // Create headers with protective properties
    const headers = {
      'Authorization': credential,
      'User-Agent': 'Discord-Bot/1.0',
      'X-Request-ID': randomUUID(),
      'X-Client-Version': '1.0.0'
    };

    // Override toString to prevent credential exposure in logs
    Object.defineProperty(headers, 'toString', {
      value: () => '[SecureHeaders - credentials hidden]',
      enumerable: false,
      writable: false
    });

    // Override inspect for console.log protection
    Object.defineProperty(headers, Symbol.for('nodejs.util.inspect.custom'), {
      value: () => '[SecureHeaders - credentials hidden]',
      enumerable: false,
      writable: false
    });

    // Override JSON.stringify protection
    Object.defineProperty(headers, 'toJSON', {
      value: () => ({ message: '[SecureHeaders - credentials hidden]' }),
      enumerable: false,
      writable: false
    });

    return headers;
  }

  /**
   * Create a secure fetch wrapper that logs safely
   */
  async secureFetch(
    url: string,
    service: 'lavalink',
    options: Record<string, unknown> = {}
  ): Promise<Response> {
    const headers = this.getSecureHeaders(service);

    const requestOptions = {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> || {})
      }
    };

    try {
      logger.debug({
        url: url.replace(/\/\/[^@]+@/, '//***:***@'), // Hide credentials in URL too
        method: (requestOptions as any).method || 'GET',
        hasAuth: !!headers.Authorization
      }, 'Making secure HTTP request');

      const response = await fetch(url, requestOptions);

      logger.debug({
        url: url.replace(/\/\/[^@]+@/, '//***:***@'),
        status: response.status,
        statusText: response.statusText
      }, 'Secure HTTP request completed');

      return response;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        url: url.replace(/\/\/[^@]+@/, '//***:***@')
      }, 'Secure HTTP request failed');

      throw error;
    }
  }

  /**
   * Validate that a credential exists and is not empty
   */
  validateCredential(service: 'lavalink'): boolean {
    const credential = this.credentials.get(service);
    return !!(credential && credential.trim().length > 0);
  }

  /**
   * Clear all stored credentials (for cleanup)
   */
  clearCredentials(): void {
    this.credentials.clear();
  }
}