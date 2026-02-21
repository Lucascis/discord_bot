import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const PROVIDER_TIMEOUT_MS = 60000;
const LAVALINK_UPDATE_TIMEOUT_MS = 10000;
const TOKEN_CACHE_FILE = '/tmp/youtube-token-cache.json';
const TOKEN_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIBRARY_PROVIDER_FAILURE_BACKOFF_MS = 12 * 60 * 60 * 1000;

type TokenSource = 'library' | 'endpoint' | 'env_fallback' | 'cache';

type TokenPair = {
  poToken: string;
  visitorData: string;
  source: TokenSource;
};

type UnknownRecord = Record<string, unknown>;

export class YouTubeTokenSyncService {
  private refreshTimer?: NodeJS.Timeout;
  private lastAppliedSignature?: string;
  private syncInFlight = false;
  private libraryProviderBackoffUntil = 0;
  private lastNoTokenWarnAt = 0;
  private libraryProviderDisabledByMemory = false;
  private endpointGuidanceLogged = false;

  start(): void {
    const hasStaticFallback = Boolean(env.YOUTUBE_PO_TOKEN && env.YOUTUBE_VISITOR_DATA);
    const autoEnabled = true;

    void this.syncNow('startup');

    this.refreshTimer = setInterval(() => {
      void this.syncNow('interval');
    }, env.YOUTUBE_TOKEN_AUTO_REFRESH_MS);

    logger.info({
      refreshMs: env.YOUTUBE_TOKEN_AUTO_REFRESH_MS,
      endpointConfigured: Boolean(this.getResolvedEndpoint()),
      staticFallbackConfigured: hasStaticFallback,
      autoEnabled,
    }, 'youtube_token_sync: automatic refresh enabled');
    if (!this.getResolvedEndpoint() && !this.endpointGuidanceLogged) {
      this.endpointGuidanceLogged = true;
      logger.info(
        'youtube_token_sync: for stable PoToken generation, prefer official youtube-trusted-session-generator via YOUTUBE_TOKEN_AUTO_ENDPOINT'
      );
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async syncNow(reason: 'startup' | 'interval'): Promise<void> {
    if (this.syncInFlight) return;
    this.syncInFlight = true;

    try {
      const hasActivePlayback = await this.hasActivePlayback();
      const allowHeavyProvider = reason === 'interval' && !hasActivePlayback && this.canUseLibraryProvider();
      logger.debug({ reason }, 'youtube_token_sync: resolving token pair');
      const tokenPair = await this.resolveTokenPair(reason, allowHeavyProvider);
      if (!tokenPair) {
        // During active playback, avoid warning spam for deferred heavy-provider attempts.
        if (reason === 'interval' && hasActivePlayback) {
          logger.debug({ reason }, 'youtube_token_sync: no token available while playback active; keeping current Lavalink state');
          return;
        }
        if (reason === 'startup') {
          logger.info({ reason }, 'youtube_token_sync: no token available at startup; continuing with current Lavalink extractor state');
          return;
        }
        const now = Date.now();
        if (now - this.lastNoTokenWarnAt > (60 * 60 * 1000)) {
          this.lastNoTokenWarnAt = now;
          logger.warn({ reason }, 'youtube_token_sync: no valid poToken/visitorData available');
        } else {
          logger.debug({ reason }, 'youtube_token_sync: no valid poToken/visitorData available (warning suppressed by cooldown)');
        }
        return;
      }

      const signature = `${tokenPair.poToken}:${tokenPair.visitorData}`;
      if (this.lastAppliedSignature === signature) {
        logger.debug({ reason, source: tokenPair.source }, 'youtube_token_sync: tokens unchanged, skipping update');
        return;
      }

      const updated = await this.pushToLavalink(tokenPair);
      if (!updated) return;

      this.lastAppliedSignature = signature;
      await this.persistTokenCache(tokenPair);
      logger.info({
        reason,
        source: tokenPair.source,
      }, 'youtube_token_sync: lavalink /youtube updated');
    } catch (error) {
      logger.error({
        reason,
        error: error instanceof Error ? error.message : String(error),
      }, 'youtube_token_sync: unexpected sync failure');
    } finally {
      this.syncInFlight = false;
    }
  }

  private async resolveTokenPair(
    reason: 'startup' | 'interval',
    allowHeavyProvider: boolean
  ): Promise<TokenPair | null> {
    // Startup path avoids heavy generation to keep the audio process responsive.
    if (reason === 'startup') {
      const fromEndpoint = await this.tryEndpointProvider();
      if (fromEndpoint) return fromEndpoint;

      const fromCache = await this.tryCacheProvider();
      if (fromCache) return fromCache;

      if (env.YOUTUBE_PO_TOKEN && env.YOUTUBE_VISITOR_DATA) {
        return {
          poToken: env.YOUTUBE_PO_TOKEN,
          visitorData: env.YOUTUBE_VISITOR_DATA,
          source: 'env_fallback',
        };
      }

      return null;
    }

    // Interval path prefers fresh tokens, but skips heavy generation during active playback.
    const fromEndpoint = await this.tryEndpointProvider();
    if (fromEndpoint) return fromEndpoint;

    const fromCache = await this.tryCacheProvider();
    if (fromCache) return fromCache;

    if (allowHeavyProvider) {
      const fromLibrary = await this.tryLibraryProvider();
      if (fromLibrary) return fromLibrary;
    } else {
      logger.debug('youtube_token_sync: deferring library provider while playback is active');
    }

    if (env.YOUTUBE_PO_TOKEN && env.YOUTUBE_VISITOR_DATA) {
      return {
        poToken: env.YOUTUBE_PO_TOKEN,
        visitorData: env.YOUTUBE_VISITOR_DATA,
        source: 'env_fallback',
      };
    }

    if ((env.YOUTUBE_PO_TOKEN && !env.YOUTUBE_VISITOR_DATA) || (!env.YOUTUBE_PO_TOKEN && env.YOUTUBE_VISITOR_DATA)) {
      logger.warn('youtube_token_sync: incomplete static fallback (both YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA are required)');
    }

    return null;
  }

  private async hasActivePlayback(): Promise<boolean> {
    const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/v4/stats`;
    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), LAVALINK_UPDATE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: env.LAVALINK_PASSWORD },
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) return false;
      const payload = await response.json() as { players?: unknown; playingPlayers?: unknown };
      const players = typeof payload.players === 'number' ? payload.players : 0;
      const playingPlayers = typeof payload.playingPlayers === 'number' ? payload.playingPlayers : 0;
      return players > 0 || playingPlayers > 0;
    } catch {
      return false;
    }
  }

  private async tryCacheProvider(): Promise<TokenPair | null> {
    try {
      const raw = await readFile(TOKEN_CACHE_FILE, 'utf8');
      const payload = JSON.parse(raw) as {
        poToken?: unknown;
        visitorData?: unknown;
        savedAt?: unknown;
      };

      const poToken = this.readString(payload.poToken);
      const visitorData = this.readString(payload.visitorData);
      const savedAt = typeof payload.savedAt === 'number' ? payload.savedAt : 0;
      if (!poToken || !visitorData || !savedAt) return null;
      if ((Date.now() - savedAt) > TOKEN_CACHE_MAX_AGE_MS) return null;

      return {
        poToken,
        visitorData,
        source: 'cache',
      };
    } catch {
      return null;
    }
  }

  private async tryLibraryProvider(): Promise<TokenPair | null> {
    if (this.libraryProviderDisabledByMemory || Date.now() < this.libraryProviderBackoffUntil) {
      logger.debug({
        retryInMs: Math.max(0, this.libraryProviderBackoffUntil - Date.now()),
        disabledByMemory: this.libraryProviderDisabledByMemory,
      }, 'youtube_token_sync: skipping library provider due to backoff');
      return null;
    }

    try {
      // Run generator in a constrained subprocess to avoid destabilizing the audio process.
      const raw = await this.runLibraryProviderSubprocess();
      const parsed = this.parseTokenPair(raw);
      if (!parsed) {
        logger.warn('youtube_token_sync: library provider returned payload without poToken/visitorData');
        return null;
      }

      return {
        poToken: parsed.poToken,
        visitorData: parsed.visitorData,
        source: 'library',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      if (lower.includes('heap out of memory') || lower.includes('allocation failed')) {
        // OOM indicates this provider is unsafe for current runtime budget.
        this.libraryProviderDisabledByMemory = true;
        this.libraryProviderBackoffUntil = Date.now() + LIBRARY_PROVIDER_FAILURE_BACKOFF_MS;
      } else {
        this.libraryProviderBackoffUntil = Date.now() + (10 * 60 * 1000);
      }
      logger.warn({
        error: message,
      }, 'youtube_token_sync: library provider failed');
      return null;
    }
  }

  private runLibraryProviderSubprocess(): Promise<unknown> {
    const inlineScript = `
      const main = async () => {
        const mod = await import('youtube-po-token-generator');
        const generate =
          (typeof mod.generate === 'function' && mod.generate) ||
          (mod.default && typeof mod.default.generate === 'function' && mod.default.generate) ||
          (typeof mod.default === 'function' && mod.default);

        if (typeof generate !== 'function') {
          throw new Error('generator function not found');
        }

        const payload = await generate();
        process.stdout.write(JSON.stringify(payload));
      };
      main().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(message);
        process.exit(1);
      });
    `;

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=512', '--input-type=module', '-e', inlineScript],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: `${process.cwd()}/audio`,
        }
      );

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('library provider timeout'));
      }, PROVIDER_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `library provider exited with code ${code ?? 'unknown'}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`library provider invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  private async tryEndpointProvider(): Promise<TokenPair | null> {
    const endpoint = this.getResolvedEndpoint();
    if (!endpoint) return null;

    try {
      const headers: Record<string, string> = {};
      if (env.YOUTUBE_TOKEN_AUTO_ENDPOINT_BEARER) {
        headers.Authorization = `Bearer ${env.YOUTUBE_TOKEN_AUTO_ENDPOINT_BEARER}`;
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), PROVIDER_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(endpoint, { headers, signal: abortController.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 503) {
        const refreshed = await this.tryRefreshEndpointToken(endpoint, headers);
        if (refreshed) {
          const retryAbortController = new AbortController();
          const retryTimeout = setTimeout(() => retryAbortController.abort(), PROVIDER_TIMEOUT_MS);
          try {
            response = await fetch(endpoint, { headers, signal: retryAbortController.signal });
          } finally {
            clearTimeout(retryTimeout);
          }
        }
      }
      if (!response.ok) {
        logger.warn({ endpoint, status: response.status }, 'youtube_token_sync: endpoint provider failed');
        return null;
      }

      const payload = await response.json() as unknown;
      const parsed = this.parseTokenPair(payload);
      if (!parsed) {
        logger.warn({ endpoint }, 'youtube_token_sync: endpoint payload missing poToken/visitorData');
        return null;
      }

      return {
        poToken: parsed.poToken,
        visitorData: parsed.visitorData,
        source: 'endpoint',
      };
    } catch (error) {
      logger.warn({
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      }, 'youtube_token_sync: endpoint provider request failed');
      return null;
    }
  }

  private async tryRefreshEndpointToken(endpoint: string, headers: Record<string, string>): Promise<boolean> {
    const refreshEndpoint = endpoint.endsWith('/token')
      ? `${endpoint.slice(0, -'/token'.length)}/update`
      : endpoint;

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), PROVIDER_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(refreshEndpoint, { headers, signal: abortController.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn({ endpoint: refreshEndpoint, status: response.status }, 'youtube_token_sync: endpoint refresh failed');
        return false;
      }

      return true;
    } catch (error) {
      logger.warn({
        endpoint: refreshEndpoint,
        error: error instanceof Error ? error.message : String(error),
      }, 'youtube_token_sync: endpoint refresh request failed');
      return false;
    }
  }

  private getResolvedEndpoint(): string | null {
    const configured = env.YOUTUBE_TOKEN_AUTO_ENDPOINT?.trim();
    return configured && configured.length > 0 ? configured : null;
  }

  private canUseLibraryProvider(): boolean {
    if (this.libraryProviderDisabledByMemory) return false;

    const nodeOptions = process.env.NODE_OPTIONS ?? '';
    const match = nodeOptions.match(/--max-old-space-size=(\d+)/);
    const maxOldSpaceMb = match ? Number.parseInt(match[1], 10) : NaN;
    if (Number.isFinite(maxOldSpaceMb) && maxOldSpaceMb <= 768) {
      this.libraryProviderDisabledByMemory = true;
      logger.info({
        maxOldSpaceMb,
      }, 'youtube_token_sync: skipping library provider due to low memory budget');
      return false;
    }

    return true;
  }

  private parseTokenPair(payload: unknown): { poToken: string; visitorData: string } | null {
    if (!payload || typeof payload !== 'object') return null;

    const object = payload as UnknownRecord;
    const poToken =
      this.readString(object.poToken) ??
      this.readString(object.potoken) ??
      this.readString(object.po_token) ??
      this.readString(object.token);
    const visitorData =
      this.readString(object.visitorData) ??
      this.readString(object.visitor_data) ??
      this.readString(object.visitor);

    if (!poToken || !visitorData) return null;
    return { poToken, visitorData };
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async persistTokenCache(tokens: TokenPair): Promise<void> {
    try {
      await writeFile(TOKEN_CACHE_FILE, JSON.stringify({
        poToken: tokens.poToken,
        visitorData: tokens.visitorData,
        savedAt: Date.now(),
      }), 'utf8');
    } catch (error) {
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
      }, 'youtube_token_sync: failed to persist token cache');
    }
  }

  private async pushToLavalink(tokens: TokenPair): Promise<boolean> {
    const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/youtube`;

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), LAVALINK_UPDATE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: env.LAVALINK_PASSWORD,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            poToken: tokens.poToken,
            visitorData: tokens.visitorData,
          }),
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn({
          source: tokens.source,
          status: response.status,
        }, 'youtube_token_sync: lavalink /youtube update rejected');
        return false;
      }

      return true;
    } catch (error) {
      logger.warn({
        source: tokens.source,
        error: error instanceof Error ? error.message : String(error),
      }, 'youtube_token_sync: failed to call lavalink /youtube');
      return false;
    }
  }
}
