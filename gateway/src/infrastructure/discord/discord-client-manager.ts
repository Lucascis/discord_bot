import { Client, GatewayIntentBits, LimitedCollection, Collection, ClientOptions } from 'discord.js';
import { logger } from '@discord-bot/logger';

export class DiscordClientManager {
    private client: Client;

    constructor() {
        this.client = new Client(this.getClientOptions());
    }

    private getClientOptions(): ClientOptions {
        return {
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ],
            // Enterprise scaling configuration
            shards: 'auto', // Auto-scale shards based on guild count
            // Connection resilience and memory optimization
            ws: {
                large_threshold: 50, // Reduced from 250 to optimize memory usage
            },
            // Rate limiting optimization
            rest: {
                timeout: 15000, // 15 second timeout
                retries: 3,
                globalRequestsPerSecond: 50 // Rate limit global requests
            },
            // Memory-optimized cache limits for SUPPORTED managers only
            makeCache: (manager) => {
                switch (manager.name) {
                    case 'UserManager':
                        return new LimitedCollection({ maxSize: 1000 });
                    case 'MessageManager':
                        return new LimitedCollection({ maxSize: 50 });
                    case 'VoiceStateManager':
                        return new LimitedCollection({ maxSize: 500 });
                    case 'GuildMemberManager':
                        return new LimitedCollection({ maxSize: 200 });
                    case 'BaseGuildEmojiManager':
                        return new LimitedCollection({ maxSize: 100 });
                    case 'PresenceManager':
                        return new LimitedCollection({ maxSize: 200 });
                    case 'ReactionManager':
                        return new LimitedCollection({ maxSize: 50 });
                    case 'GuildBanManager':
                        return new LimitedCollection({ maxSize: 100 });
                    case 'GuildInviteManager':
                        return new LimitedCollection({ maxSize: 50 });
                    case 'ThreadManager':
                        return new LimitedCollection({ maxSize: 100 });
                    default:
                        return new Collection();
                }
            }
        };
    }

    public getClient(): Client {
        return this.client;
    }

    public async login(token: string): Promise<void> {
        try {
            await this.client.login(token);
            logger.info('Discord client logged in successfully');
        } catch (error) {
            logger.error({ error }, 'Failed to login to Discord');
            throw error;
        }
    }

    public async logout(): Promise<void> {
        try {
            await this.client.destroy();
            logger.info('Discord client logged out successfully');
        } catch (error) {
            logger.error({ error }, 'Failed to logout from Discord');
            throw error;
        }
    }
}
