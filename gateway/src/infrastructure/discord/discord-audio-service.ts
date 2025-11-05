import { AudioService } from '../../application/use-cases/play-music-use-case.js';
import { logger } from '@discord-bot/logger';

/**
 * Discord Audio Service Implementation
 * Adapter that communicates with the audio service via Redis pub/sub
 */
export class DiscordAudioService implements AudioService {
  private readonly pendingRequests: Map<string, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }> = new Map();

  constructor(
    private readonly redisPublisher: { publish: (channel: string, message: string) => Promise<void> }, // Redis client for publishing
    private readonly redisSubscriber: { subscribe: (channel: string, callback: (message: string, channel: string) => void) => Promise<void>; unsubscribe?: (channel: string) => Promise<void> }, // Redis client for subscribing
    private readonly searchCache: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown, ttl?: number) => Promise<void> } // Search cache implementation
  ) {
    this.initializeResponseHandler();
  }

  async searchTrack(query: string, guildId: string, voiceChannelId?: string, textChannelId?: string, userId?: string): Promise<{
    tracks: Array<{ title: string; uri: string; duration: number }>;
    source: 'youtube' | 'spotify' | 'other';
    latency: number;
    cached: boolean;
  }> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = `search:${Buffer.from(query).toString('base64')}`;
      const cached = await this.searchCache.get(cacheKey);

      if (cached && typeof cached === 'object' && 'tracks' in cached && 'source' in cached) {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tracks: (cached as any).tracks,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          source: (cached as any).source as 'youtube' | 'spotify' | 'other',
          latency: Date.now() - startTime,
          cached: true
        };
      }

      // Use a play command but extract only the search results
      // The audio service will search but we'll only use the search response
      const searchRequest = {
        type: 'play',
        guildId,
        query,
        voiceChannelId: voiceChannelId || 'fallback-voice-channel',
        textChannelId: textChannelId || 'fallback-text-channel',
        userId: userId || 'search-user',
        requestId: this.generateRequestId()
      };

      await this.redisPublisher.publish('discord-bot:to-audio', JSON.stringify(searchRequest));

      // Wait for response
      const response = await this.waitForSearchResponse(searchRequest.requestId);

      if (!response || !response.tracks) {
        return {
          tracks: [],
          source: 'other',
          latency: Date.now() - startTime,
          cached: false
        };
      }

      // Cache the result
      await this.searchCache.set(cacheKey, {
        tracks: response.tracks,
        source: response.source
      }, 300); // 5 minutes

      return {
        tracks: response.tracks,
        source: (response.source as 'youtube' | 'spotify' | 'other') || 'other',
        latency: Date.now() - startTime,
        cached: false
      };

    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async playTrack(guildId: string, trackUri: string, voiceChannelId: string): Promise<{
    success: boolean;
    message: string;
    queuePosition?: number;
  }> {
    try {
      const playRequest = {
        type: 'play',
        guildId,
        trackUri,
        voiceChannelId,
        requestId: this.generateRequestId()
      };

      await this.redisPublisher.publish('discord-bot:to-audio', JSON.stringify(playRequest));

      // Wait for response
      const response = await this.waitForPlayResponse(playRequest.requestId);

      return {
        success: response?.success ?? false,
        message: response?.message ?? 'Unknown error',
        queuePosition: response?.queuePosition
      };

    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Play request failed'
      };
    }
  }

  async isConnectedToVoice(guildId: string): Promise<boolean> {
    try {
      const statusRequest = {
        type: 'voice_status',
        guildId,
        requestId: this.generateRequestId()
      };

      await this.redisPublisher.publish('discord-bot:to-audio', JSON.stringify(statusRequest));

      // Wait for response
      const response = await this.waitForStatusResponse(statusRequest.requestId);

      return response?.connected ?? false;

    } catch {
      return false;
    }
  }

  async connectToVoice(guildId: string, voiceChannelId: string): Promise<void> {
    try {
      const connectRequest = {
        type: 'voice_connect',
        guildId,
        voiceChannelId,
        requestId: this.generateRequestId()
      };

      await this.redisPublisher.publish('discord-bot:to-audio', JSON.stringify(connectRequest));

      // Wait for connection confirmation
      const response = await this.waitForConnectResponse(connectRequest.requestId);

      if (!response?.success) {
        throw new Error(response?.message || 'Failed to connect to voice channel');
      }

    } catch (error) {
      throw new Error(`Voice connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize Redis response handler for audio service responses
   */
  private initializeResponseHandler(): void {
    // Subscribe to a generic response pattern - we'll filter by requestId
    // Note: This is a simplified approach. In production, you might want to use pattern subscription
    this.setupResponseListener();
  }

  /**
   * Setup listener for all response channels
   */
  private async setupResponseListener(): Promise<void> {
    try {
      // Subscribe to response pattern channel if supported, otherwise handle in message handler
      // For now, we'll dynamically subscribe to specific requestId channels
      logger.debug('Discord Audio Service response handler initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to setup response listener');
    }
  }

  /**
   * Wait for a response from the audio service for a specific request
   */
  private async waitForResponse<T>(requestId: string, timeoutMs: number = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Store the promise handlers
      this.pendingRequests.set(requestId, {
        resolve: (value: T) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          reject(error);
        },
        timeoutId
      });

      // Subscribe to the specific response channel for this request
      const responseChannel = `discord-bot:response:${requestId}`;

      // Create a one-time message handler for this specific request
      const messageHandler = (message: string, channel: string) => {
        // Only handle messages for our specific request ID channel
        if (channel !== responseChannel) return;

        try {
          const response = JSON.parse(message);
          const pendingRequest = this.pendingRequests.get(requestId);
          if (pendingRequest) {
            if (response.error) {
              pendingRequest.reject(new Error(response.error));
            } else {
              pendingRequest.resolve(response);
            }
            // Clean up: unsubscribe after receiving response
            this.redisSubscriber.unsubscribe?.(responseChannel);
          }
        } catch (parseError) {
          const pendingRequest = this.pendingRequests.get(requestId);
          if (pendingRequest) {
            pendingRequest.reject(new Error(`Failed to parse response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`));
            // Clean up: unsubscribe after error
            this.redisSubscriber.unsubscribe?.(responseChannel);
          }
        }
      };

      this.redisSubscriber.subscribe(responseChannel, messageHandler).catch(error => {
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest) {
          pendingRequest.reject(new Error(`Failed to subscribe to response channel: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      });
    });
  }

  private async waitForSearchResponse(requestId: string, timeoutMs: number = 10000): Promise<{ tracks: Array<{ title: string; uri: string; duration: number }>; source: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.waitForResponse<any>(requestId, timeoutMs);

      // Handle search response format from audio service
      if (response.ok === false && response.reason === 'no_results') {
        return {
          tracks: [],
          source: 'other'
        };
      }

      if (response.tracks) {
        return {
          tracks: response.tracks,
          source: response.source || 'other'
        };
      }

      // Fallback for unexpected response format
      return {
        tracks: [],
        source: 'other'
      };
    } catch (error) {
      logger.error({ error, requestId }, 'Search request failed');
      return {
        tracks: [],
        source: 'other'
      };
    }
  }

  private async waitForPlayResponse(requestId: string, timeoutMs: number = 5000): Promise<{ success: boolean; message: string; queuePosition?: number }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.waitForResponse<any>(requestId, timeoutMs);

      if (response.ok === true) {
        return {
          success: true,
          message: response.title ? `Added "${response.title}" to queue` : 'Track added to queue',
          queuePosition: response.queuePosition
        };
      } else if (response.ok === false) {
        return {
          success: false,
          message: response.message || response.reason || 'Unknown error'
        };
      }

      // Fallback for unexpected response format
      return {
        success: false,
        message: 'Unexpected response format'
      };
    } catch (error) {
      logger.error({ error, requestId }, 'Play request failed');
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Play request failed'
      };
    }
  }

  private async waitForStatusResponse(requestId: string, timeoutMs: number = 3000): Promise<{ connected: boolean }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.waitForResponse<any>(requestId, timeoutMs);

      return {
        connected: response.connected || false
      };
    } catch (error) {
      logger.error({ error, requestId }, 'Status request failed');
      return {
        connected: false
      };
    }
  }

  private async waitForConnectResponse(requestId: string, timeoutMs: number = 5000): Promise<{ success: boolean; message?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await this.waitForResponse<any>(requestId, timeoutMs);

      if (response.ok === true || response.success === true) {
        return {
          success: true,
          message: response.message || 'Connected to voice channel'
        };
      } else {
        return {
          success: false,
          message: response.message || response.reason || 'Connection failed'
        };
      }
    } catch (error) {
      logger.error({ error, requestId }, 'Connect request failed');
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }
}