import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { spawn } from 'node:child_process';

const PROVIDER_TIMEOUT_MS = 10000;

type TokenSource = 'library' | 'endpoint' | 'env_fallback';

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

  start(): void {
    const hasStaticFallback = Boolean(env.YOUTUBE_PO_TOKEN && env.YOUTUBE_VISITOR_DATA);
    if (!env.YOUTUBE_TOKEN_AUTO_ENABLED && !hasStaticFallback) {
      logger.info('youtube_token_sync: disabled (no auto mode and no static fallback)');
      return;
    }

    void this.syncNow('startup');

    if (env.YOUTUBE_TOKEN_AUTO_ENABLED) {
      this.refreshTimer = setInterval(() => {
        void this.syncNow('interval');
      }, env.YOUTUBE_TOKEN_AUTO_REFRESH_MS);

      logger.info({
        refreshMs: env.YOUTUBE_TOKEN_AUTO_REFRESH_MS,
        endpointConfigured: Boolean(env.YOUTUBE_TOKEN_AUTO_ENDPOINT),
      }, 'youtube_token_sync: automatic refresh enabled');
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
      logger.debug({ reason }, 'youtube_token_sync: resolving token pair');
      const tokenPair = await this.resolveTokenPair();
      if (!tokenPair) {
        logger.warn({ reason }, 'youtube_token_sync: no valid poToken/visitorData available');
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

  private async resolveTokenPair(): Promise<TokenPair | null> {
    if (env.YOUTUBE_TOKEN_AUTO_ENABLED) {
      const fromLibrary = await this.tryLibraryProvider();
      if (fromLibrary) return fromLibrary;

      const fromEndpoint = await this.tryEndpointProvider();
      if (fromEndpoint) return fromEndpoint;
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

  private async tryLibraryProvider(): Promise<TokenPair | null> {
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
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
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
        ['--max-old-space-size=256', '--input-type=module', '-e', inlineScript],
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
    const endpoint = env.YOUTUBE_TOKEN_AUTO_ENDPOINT?.trim();
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

  private async pushToLavalink(tokens: TokenPair): Promise<boolean> {
    const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/youtube`;

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), PROVIDER_TIMEOUT_MS);
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
