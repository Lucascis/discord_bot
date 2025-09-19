const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const GUILD_ID = "375086837103984650";

if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
    console.error('Missing DISCORD_TOKEN or DISCORD_APPLICATION_ID in .env');
    process.exit(1);
}

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// Create Lavalink Manager (will be initialized after client is ready)
let lavalink;

// Store for now playing messages and progress tracking
const nowPlayingMessages = new Map();
const progressTrackers = new Map();

// Progress update configuration
const PROGRESS_UPDATE_INTERVAL = 10000; // 10 seconds - optimal for thousands of servers
const PROGRESS_BAR_LENGTH = 20;
const MAX_CONCURRENT_UPDATES = 50; // Limit concurrent message updates

// Define commands
const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('YouTube URL or search query')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music and disconnect'),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the music'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the music'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the music queue'),
    new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show current song'),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check if bot is working')
];

// Register commands
async function deployCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);

    try {
        console.log('🔄 Registering slash commands...');

        await rest.put(
            Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, GUILD_ID),
            { body: commands.map(command => command.toJSON()) }
        );

        console.log('✅ Successfully registered slash commands!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Progress tracker for efficient updates
class ProgressTracker {
    constructor(guildId, player, track, message) {
        this.guildId = guildId;
        this.player = player;
        this.track = track;
        this.message = message;
        this.startTime = Date.now();
        this.lastUpdate = 0;
        this.isActive = true;
        this.updateCount = 0;

        // Start progress updates with smart intervals
        this.startProgressUpdates();
    }

    startProgressUpdates() {
        // Use dynamic intervals based on track duration
        const duration = this.track.info.duration;
        let interval = PROGRESS_UPDATE_INTERVAL;

        // Shorter intervals for shorter tracks, longer for long tracks
        if (duration < 120000) { // < 2 minutes
            interval = 5000; // 5 seconds
        } else if (duration > 900000) { // > 15 minutes
            interval = 20000; // 20 seconds
        }

        this.progressInterval = setInterval(() => {
            this.updateProgress();
        }, interval);

        console.log(`📊 Started progress tracking for ${this.track.info.title} (${formatDuration(duration)}) with ${interval/1000}s intervals`);
    }

    async updateProgress() {
        if (!this.isActive || !this.player || !this.player.playing) {
            this.stop();
            return;
        }

        try {
            // Rate limiting: don't update if too many concurrent updates
            const activeTrackers = Array.from(progressTrackers.values()).filter(t => t.isActive);
            if (activeTrackers.length > MAX_CONCURRENT_UPDATES) {
                // Skip this update for older trackers
                const sortedTrackers = activeTrackers.sort((a, b) => a.startTime - b.startTime);
                const myIndex = sortedTrackers.findIndex(t => t.guildId === this.guildId);
                if (myIndex >= MAX_CONCURRENT_UPDATES) {
                    return;
                }
            }

            // Get current position
            const position = this.player.position || 0;
            const now = Date.now();

            // Only update if significant time has passed or significant position change
            const timeDiff = now - this.lastUpdate;
            const significantChange = timeDiff >= PROGRESS_UPDATE_INTERVAL * 0.8;

            if (!significantChange && this.updateCount > 0) {
                return;
            }

            // Check if message still exists and is editable
            if (!this.message || !this.message.editable) {
                this.stop();
                return;
            }

            // Create updated embed with current progress
            const embed = await createNowPlayingEmbed(this.player, this.track, position);

            await this.message.edit({ embeds: [embed] });

            this.lastUpdate = now;
            this.updateCount++;

            // Auto-stop for very long tracks to prevent memory leaks
            if (this.updateCount > 100) { // Max ~16 minutes of updates
                console.log(`🛑 Auto-stopping progress tracker for ${this.track.info.title} after 100 updates`);
                this.stop();
            }

        } catch (error) {
            // If update fails, stop tracking to prevent spam
            console.error(`❌ Progress update failed for guild ${this.guildId}:`, error.message);
            this.stop();
        }
    }

    stop() {
        this.isActive = false;
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        progressTrackers.delete(this.guildId);
        console.log(`🛑 Stopped progress tracking for guild ${this.guildId}`);
    }
}

// Bot event handlers
client.once('ready', () => {
    console.log(`🤖 Bot ready! Logged in as ${client.user.tag}`);

    // Initialize Lavalink Manager after client is ready
    lavalink = new LavalinkManager({
        nodes: [
            {
                host: 'localhost',
                port: 2333,
                authorization: 'youshallnotpass',
                id: 'main',
                retryAmount: 3,
                retryDelay: 3000
            }
        ],
        client: {
            id: client.user.id,
            username: client.user.username
        },
        sendToShard: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard?.send(payload);
        }
    });

    // Set up Lavalink events
    lavalink.on('nodeCreate', (node) => {
        console.log(`🔗 Lavalink node created: ${node.id}`);
    });

    lavalink.on('nodeConnect', (node) => {
        console.log(`✅ Lavalink node connected: ${node.id}`);
    });

    lavalink.on('nodeError', (node, error) => {
        console.error(`❌ Lavalink node error on ${node.id}:`, error);
    });

    lavalink.on('trackStart', async (player, track) => {
        console.log(`🎵 Now playing: ${track.info.title} by ${track.info.author}`);

        const channel = client.channels.cache.get(player.textChannelId);
        if (channel) {
            // Stop any existing progress tracker for this guild
            const existingTracker = progressTrackers.get(player.guildId);
            if (existingTracker) {
                existingTracker.stop();
            }

            // Clean up old message
            const oldMessage = nowPlayingMessages.get(player.guildId);
            if (oldMessage && oldMessage.deletable) {
                try {
                    await oldMessage.delete();
                } catch (error) {
                    // Ignore deletion errors
                }
            }

            const embed = await createNowPlayingEmbed(player, track, 0);
            const components = createMusicControls();

            try {
                const message = await channel.send({
                    embeds: [embed],
                    components: [components]
                });

                // Store the message for updates
                nowPlayingMessages.set(player.guildId, message);

                // Start progress tracking for tracks longer than 30 seconds
                if (track.info.duration > 30000) {
                    const tracker = new ProgressTracker(player.guildId, player, track, message);
                    progressTrackers.set(player.guildId, tracker);
                }

                console.log(`📺 Now playing message sent for: ${track.info.title}`);
            } catch (error) {
                console.error('Error sending now playing message:', error);
            }
        }
    });

    lavalink.on('trackEnd', (player, track) => {
        console.log(`⏹️ Finished playing: ${track.info.title}`);

        // Stop progress tracking
        const tracker = progressTrackers.get(player.guildId);
        if (tracker) {
            tracker.stop();
        }

        // Clean up now playing message when track ends
        const message = nowPlayingMessages.get(player.guildId);
        if (message && player.queue.tracks.length === 0) {
            setTimeout(() => {
                if (message.deletable) {
                    message.delete().catch(() => {});
                }
                nowPlayingMessages.delete(player.guildId);
            }, 10000); // Delete after 10 seconds
        }
    });

    lavalink.on('queueEnd', (player) => {
        console.log(`📭 Queue ended for guild ${player.guildId}`);

        // Stop progress tracking
        const tracker = progressTrackers.get(player.guildId);
        if (tracker) {
            tracker.stop();
        }

        const channel = client.channels.cache.get(player.textChannelId);
        if (channel) {
            channel.send('📭 Queue finished! Add more songs or I\'ll disconnect in 30 seconds.');
        }

        // Clean up now playing message
        const message = nowPlayingMessages.get(player.guildId);
        if (message && message.deletable) {
            message.delete().catch(() => {});
            nowPlayingMessages.delete(player.guildId);
        }

        // Auto-disconnect after 30 seconds of inactivity
        setTimeout(() => {
            if (player.queue.tracks.length === 0) {
                player.destroy();
                console.log(`🔌 Auto-disconnected from guild ${player.guildId}`);
            }
        }, 30000);
    });

    // Initialize Lavalink
    lavalink.init({
        shards: client.ws.totalShards || 1
    });

    // Set up raw data handler after lavalink is initialized
    client.on('raw', (data) => {
        lavalink.sendRawData(data);
    });

    deployCommands();
});

// Music Controls
function createMusicControls() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setLabel('⏸️ Pause')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_resume')
                .setLabel('▶️ Resume')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setLabel('⏭️ Skip')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setLabel('⏹️ Stop')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setLabel('📜 Queue')
                .setStyle(ButtonStyle.Secondary)
        );
}

async function createNowPlayingEmbed(player, track, currentPosition = null) {
    // Use provided position or get from player
    const position = currentPosition !== null ? currentPosition : (player.position || 0);

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🎵 Now Playing')
        .setDescription(`**${track.info.title}**`)
        .addFields(
            { name: '🎤 Artist', value: track.info.author || 'Unknown', inline: true },
            { name: '⏱️ Duration', value: formatDuration(track.info.duration), inline: true },
            { name: '🔊 Volume', value: `${player.volume}%`, inline: true },
            { name: '🔁 Loop', value: player.repeatMode === 'off' ? 'Off' : player.repeatMode, inline: true },
            { name: '📊 Queue', value: `${player.queue.tracks.length} songs`, inline: true },
            { name: '👤 Requested by', value: track.requester?.username || 'Unknown', inline: true }
        )
        .setThumbnail(track.info.artworkUrl || null)
        .setFooter({ text: 'Use the buttons below to control playback' })
        .setTimestamp();

    // Add progress bar with real-time position
    if (track.info.duration && track.info.duration > 0) {
        const duration = track.info.duration;
        const progressPercent = Math.min(position / duration, 1); // Ensure it doesn't exceed 100%
        const progress = Math.floor(progressPercent * PROGRESS_BAR_LENGTH);
        const progressBar = '█'.repeat(progress) + '▓'.repeat(PROGRESS_BAR_LENGTH - progress);
        const percentage = Math.floor(progressPercent * 100);

        embed.addFields({
            name: `🎵 Progress (${percentage}%)`,
            value: `\`${formatDuration(position)} ${progressBar} ${formatDuration(duration)}\``,
            inline: false
        });
    }

    return embed;
}

// Button interaction handler
client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const player = lavalink.getPlayer(interaction.guildId);

        if (!player) {
            return await interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }

        try {
            switch (interaction.customId) {
                case 'music_pause':
                    if (!player.playing) {
                        return await interaction.reply({ content: '❌ Music is not playing!', ephemeral: true });
                    }
                    await player.pause();
                    await interaction.reply({ content: '⏸️ Music paused!', ephemeral: true });

                    // Stop progress updates when paused
                    const pauseTracker = progressTrackers.get(interaction.guildId);
                    if (pauseTracker) {
                        pauseTracker.stop();
                    }
                    break;

                case 'music_resume':
                    if (!player.paused) {
                        return await interaction.reply({ content: '❌ Music is not paused!', ephemeral: true });
                    }
                    await player.resume();
                    await interaction.reply({ content: '▶️ Music resumed!', ephemeral: true });

                    // Restart progress updates when resumed
                    const resumeTrack = player.queue.current;
                    const message = nowPlayingMessages.get(interaction.guildId);
                    if (resumeTrack && message && resumeTrack.info.duration > 30000) {
                        const tracker = new ProgressTracker(interaction.guildId, player, resumeTrack, message);
                        progressTrackers.set(interaction.guildId, tracker);
                    }
                    break;

                case 'music_skip':
                    if (!player.playing && !player.paused) {
                        return await interaction.reply({ content: '❌ No music is playing!', ephemeral: true });
                    }
                    const currentTrack = player.queue.current;
                    await player.skip();
                    await interaction.reply({
                        content: `⏭️ Skipped: **${currentTrack?.info?.title || 'Unknown Track'}**`,
                        ephemeral: true
                    });
                    break;

                case 'music_stop':
                    // Stop progress tracking
                    const stopTracker = progressTrackers.get(interaction.guildId);
                    if (stopTracker) {
                        stopTracker.stop();
                    }

                    await player.destroy();
                    nowPlayingMessages.delete(interaction.guildId);
                    await interaction.reply({ content: '⏹️ Music stopped and disconnected!', ephemeral: true });
                    break;

                case 'music_queue':
                    const queueEmbed = createQueueEmbed(player);
                    await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
                    break;
            }
        } catch (error) {
            console.error('Error handling button interaction:', error);
            await interaction.reply({ content: '❌ An error occurred!', ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    console.log(`📝 Command received: /${interaction.commandName} from ${interaction.user.username}`);

    try {
        switch (interaction.commandName) {
            case 'ping':
                await interaction.reply('🏓 Pong! Music bot is working correctly!');
                break;

            case 'play':
                await handlePlayCommand(interaction);
                break;

            case 'stop':
                await handleStopCommand(interaction);
                break;

            case 'pause':
                await handlePauseCommand(interaction);
                break;

            case 'resume':
                await handleResumeCommand(interaction);
                break;

            case 'skip':
                await handleSkipCommand(interaction);
                break;

            case 'queue':
                await handleQueueCommand(interaction);
                break;

            case 'nowplaying':
                await handleNowPlayingCommand(interaction);
                break;

            default:
                await interaction.reply('❌ Unknown command');
        }
    } catch (error) {
        console.error('Error handling command:', error);
        try {
            const errorMsg = '❌ An error occurred while processing the command';
            if (interaction.replied) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        } catch (e) {
            console.error('Failed to send error message:', e);
        }
    }
});

async function handlePlayCommand(interaction) {
    // Try both possible parameter names in case of command cache issues
    const query = interaction.options.getString('query') || interaction.options.getString('url');
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    console.log(`🔍 Play command received with query: "${query}"`);

    if (!query || query === 'null') {
        return await interaction.reply('❌ Please provide a valid song URL or search query!');
    }

    if (!voiceChannel) {
        return await interaction.reply('❌ You need to be in a voice channel to play music!');
    }

    await interaction.deferReply();

    try {
        // Create or get existing player
        let player = lavalink.getPlayer(interaction.guildId);

        if (!player) {
            player = await lavalink.createPlayer({
                guildId: interaction.guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: interaction.channelId,
                volume: 50,
                selfDeaf: true
            });
            console.log(`🎤 Created new player for guild ${interaction.guildId}`);
        }

        // Connect to voice channel if not connected
        if (!player.connected) {
            await player.connect();
            console.log(`🔗 Connected to voice channel: ${voiceChannel.name}`);
        }

        // Search for tracks using the player's search method
        console.log(`🔍 Searching for: ${query}`);
        const result = await player.search({
            query: query,
            source: 'ytsearch'
        }, interaction.user);

        if (!result || !result.tracks || result.tracks.length === 0) {
            return await interaction.editReply('❌ No tracks found for your search!');
        }

        const track = result.tracks[0];

        // Add track to queue
        await player.queue.add(track);
        console.log(`➕ Added to queue: ${track.info.title}`);

        // Start playing if not already playing
        if (!player.playing && !player.paused && player.queue.tracks.length === 1) {
            await player.play();
            console.log(`▶️ Started playing: ${track.info.title}`);
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(player.playing ? '🎵 Track Added to Queue' : '🎵 Now Playing')
            .setDescription(`**${track.info.title}** by ${track.info.author}`)
            .addFields(
                {
                    name: 'Duration',
                    value: formatDuration(track.info.duration),
                    inline: true
                },
                {
                    name: 'Position in Queue',
                    value: player.queue.tracks.length === 1 ? 'Now Playing' : `${player.queue.tracks.length}`,
                    inline: true
                }
            )
            .setThumbnail(track.info.artworkUrl || null);

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error in play command:', error);
        console.error('Error stack:', error.stack);
        await interaction.editReply(`❌ Failed to play the track: ${error.message}`);
    }
}

async function handleStopCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player) {
        return await interaction.reply('❌ No music is currently playing!');
    }

    // Stop progress tracking
    const tracker = progressTrackers.get(interaction.guildId);
    if (tracker) {
        tracker.stop();
    }

    await player.destroy();
    nowPlayingMessages.delete(interaction.guildId);
    console.log(`⏹️ Stopped music for guild ${interaction.guildId}`);

    await interaction.reply('⏹️ Music stopped and disconnected from voice channel!');
}

async function handlePauseCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player || !player.playing) {
        return await interaction.reply('❌ No music is currently playing!');
    }

    await player.pause();

    // Stop progress updates when paused
    const tracker = progressTrackers.get(interaction.guildId);
    if (tracker) {
        tracker.stop();
    }

    console.log(`⏸️ Paused music for guild ${interaction.guildId}`);
    await interaction.reply('⏸️ Music paused!');
}

async function handleResumeCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player || !player.paused) {
        return await interaction.reply('❌ Music is not paused!');
    }

    await player.resume();

    // Restart progress updates when resumed
    const resumedTrack = player.queue.current;
    const message = nowPlayingMessages.get(interaction.guildId);
    if (resumedTrack && message && resumedTrack.info.duration > 30000) {
        const tracker = new ProgressTracker(interaction.guildId, player, resumedTrack, message);
        progressTrackers.set(interaction.guildId, tracker);
    }

    console.log(`▶️ Resumed music for guild ${interaction.guildId}`);
    await interaction.reply('▶️ Music resumed!');
}

async function handleSkipCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player || !player.playing) {
        return await interaction.reply('❌ No music is currently playing!');
    }

    const currentTrack = player.queue.current;
    await player.skip();
    console.log(`⏭️ Skipped track for guild ${interaction.guildId}`);

    if (currentTrack) {
        await interaction.reply(`⏭️ Skipped: **${currentTrack.info.title}**`);
    } else {
        await interaction.reply('⏭️ Track skipped!');
    }
}

async function handleQueueCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player) {
        return await interaction.reply('❌ No music is currently playing!');
    }

    const queueEmbed = createQueueEmbed(player);
    await interaction.reply({ embeds: [queueEmbed] });
}

async function handleNowPlayingCommand(interaction) {
    const player = lavalink.getPlayer(interaction.guildId);

    if (!player || !player.queue.current) {
        return await interaction.reply('❌ No music is currently playing!');
    }

    const embed = await createNowPlayingEmbed(player, player.queue.current);
    const components = createMusicControls();

    await interaction.reply({ embeds: [embed], components: [components] });
}

function createQueueEmbed(player) {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('📜 Music Queue')
        .setTimestamp();

    if (player.queue.current) {
        embed.addFields({
            name: '🎵 Currently Playing',
            value: `**${player.queue.current.info.title}** by ${player.queue.current.info.author}`,
            inline: false
        });
    }

    if (player.queue.tracks.length > 0) {
        const upcoming = player.queue.tracks.slice(0, 10).map((track, index) =>
            `${index + 1}. **${track.info.title}** by ${track.info.author} \`[${formatDuration(track.info.duration)}]\``
        ).join('\n');

        embed.addFields({
            name: `📋 Up Next (${player.queue.tracks.length} songs)`,
            value: upcoming,
            inline: false
        });

        if (player.queue.tracks.length > 10) {
            embed.addFields({
                name: '➕ And More...',
                value: `${player.queue.tracks.length - 10} more tracks in queue`,
                inline: false
            });
        }
    } else {
        embed.addFields({
            name: '📋 Up Next',
            value: 'No tracks in queue',
            inline: false
        });
    }

    return embed;
}

function formatDuration(ms) {
    if (!ms || ms === 0) return '00:00';

    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Cleanup on process exit
process.on('SIGTERM', () => {
    console.log('🛑 Cleaning up progress trackers...');
    progressTrackers.forEach(tracker => tracker.stop());
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Cleaning up progress trackers...');
    progressTrackers.forEach(tracker => tracker.stop());
    process.exit(0);
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

// Start the bot
console.log('🚀 Starting optimized Discord music bot with real-time progress...');
client.login(DISCORD_TOKEN);