import {
    LavalinkManager as LibraryLavalinkManager,
    type LavalinkNode,
    type GuildShardPayload,
    type BotClientOptions,
} from 'lavalink-client';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisManager } from '../redis/redis-manager.js';

export class LavalinkManager {
    public readonly library: LibraryLavalinkManager;

    constructor(private redisManager: RedisManager) {
        this.library = new LibraryLavalinkManager({
            nodes: [
                {
                    id: 'main',
                    host: env.LAVALINK_HOST,
                    port: env.LAVALINK_PORT,
                    authorization: env.LAVALINK_PASSWORD,
                    secure: false,
                },
            ],
            sendToShard: (guildId, payload) => this.sendToShard(guildId, payload),
            client: {
                id: env.DISCORD_APPLICATION_ID,
                username: 'NebuDJ',
            },
        });

        this.setupEventListeners();
    }

    private async sendToShard(guildId: string, payload: GuildShardPayload): Promise<void> {
        try {
            const publishResult = await this.redisManager.getPublisher().publish(
                'discord-bot:to-discord',
                JSON.stringify({ guildId, payload }),
            );

            if (publishResult === 0) {
                const metrics = this.redisManager.getPublisher().getMetrics();
                logger.error({
                    guildId,
                    publishResult,
                    circuitState: metrics.state,
                    redisStatus: metrics.redisStatus,
                    channel: 'discord-bot:to-discord'
                }, 'CRITICAL: No subscribers for to-discord channel, Gateway may not be listening');
            }
        } catch (e) {
            logger.error({ e }, 'failed to publish to-discord payload');
        }
    }

    private setupEventListeners(): void {
        this.library.nodeManager.on('connect', (node: LavalinkNode) =>
            logger.info(`Node ${node.id} connected`),
        );
        this.library.nodeManager.on('error', (node: LavalinkNode, error: Error) =>
            logger.error({
                signal: 'lavalink_node_error',
                nodeId: node.id,
                nodeSessionId: node.sessionId,
                message: error.message,
                stack: error.stack,
            }, `Node ${node.id} error`),
        );
    }

    public async initialize(): Promise<void> {
        await this.waitForLavalinkRestReady();
        await this.library.init({ id: env.DISCORD_APPLICATION_ID, username: 'NebuDJ' } as BotClientOptions);
    }

    public async fetchStats(): Promise<{ players: number; playingPlayers: number } | null> {
        const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/v4/stats`;
        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: env.LAVALINK_PASSWORD
                }
            });

            if (!res.ok) {
                logger.warn({ status: res.status }, 'Failed to fetch Lavalink stats');
                return null;
            }

            const stats = await res.json() as {
                players?: number;
                playingPlayers?: number;
            };

            return {
                players: stats.players ?? 0,
                playingPlayers: stats.playingPlayers ?? 0
            };
        } catch (error) {
            logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Error while fetching Lavalink stats');
            return null;
        }
    }

    private async waitForLavalinkRestReady(maxWaitMs = 60000): Promise<boolean> {
        const deadline = Date.now() + maxWaitMs;
        const url = `http://${env.LAVALINK_HOST}:${env.LAVALINK_PORT}/v4/stats`;

        while (Date.now() < deadline) {
            try {
                const res = await fetch(url, {
                    headers: {
                        'Authorization': env.LAVALINK_PASSWORD
                    }
                });
                if (res.ok) {
                    const j = (await res.json()) as { players?: unknown; playingPlayers?: unknown };
                    if (j && j.players !== undefined && j.playingPlayers !== undefined) {
                        logger.info('Lavalink REST API ready');
                        return true;
                    }
                }
            } catch (error) {
                logger.debug({
                    error: error instanceof Error ? error.message : String(error),
                    timeRemaining: deadline - Date.now()
                }, 'Waiting for Lavalink to become ready');
            }
            await delay(1000);
        }

        logger.error({ maxWaitMs }, 'Lavalink REST API failed to become ready within timeout');
        return false;
    }
}
