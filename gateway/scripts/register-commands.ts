import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
dotenv.config({ path: resolve(process.cwd(), '.env') });

/**
 * Discord Slash Commands Registration Script
 * Registers all music bot commands for the gateway service
 */

const commands = [
  // Music playback commands
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or playlist')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song name, artist, or URL (YouTube, Spotify, etc.)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Add a track to the front of the queue')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song name, artist, or URL')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('playnow')
    .setDescription('Stop current track and play immediately')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song name, artist, or URL')
        .setRequired(true)
    ),

  // Music control commands
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Vote to skip the current track (requires multiple users)'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (0-200%)')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume percentage (0-200)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200)
    ),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current Track', value: 'track' },
          { name: 'Entire Queue', value: 'queue' }
        )
    ),

  // Queue management commands
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number (10 tracks per page)')
        .setRequired(false)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queue'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear the queue (keeps current track)'),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue')
    .addIntegerOption(option =>
      option.setName('index')
        .setDescription('Track position in queue (1-based)')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a track to a different position')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('Current position (1-based)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('New position (1-based)')
        .setRequired(true)
        .setMinValue(1)
    ),

  // Information commands
  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show currently playing track'),

  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a specific position in the current track')
    .addIntegerOption(option =>
      option.setName('seconds')
        .setDescription('Position in seconds')
        .setRequired(true)
        .setMinValue(0)
    ),

  // Autoplay command
  new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay or set autoplay mode')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Autoplay mode (leave empty to toggle on/off)')
        .setRequired(false)
        .addChoices(
          { name: '❌ Disable autoplay', value: 'off' },
          { name: '🎵 Similar tracks', value: 'similar' },
          { name: '👤 Same artist', value: 'artist' },
          { name: '🎸 Same genre', value: 'genre' },
          { name: '🔀 Mixed (artist + genre + similar)', value: 'mixed' }
        )
    ),

  // Guild settings commands
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot settings for this server')
    .addSubcommand(subcommand =>
      subcommand
        .setName('button-feedback')
        .setDescription('Enable or disable feedback messages when pressing buttons')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Show feedback messages when pressing music control buttons')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('dj-role')
        .setDescription('Set the DJ role for this server')
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('Role that can control music playback')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('djonly-mode')
        .setDescription('Enable or disable DJ only mode')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable DJ only mode (only users with DJ role can control music)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('voteskip-enabled')
        .setDescription('Enable or disable vote skip functionality')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable vote skip (allows users to vote to skip tracks)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('voteskip-threshold')
        .setDescription('Set the percentage of users needed to skip a track')
        .addNumberOption(option =>
          option.setName('threshold')
            .setDescription('Percentage of voice channel users needed (1-100%)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('autoplay')
        .setDescription('Configure autoplay settings')
        .addStringOption(option =>
          option.setName('mode')
            .setDescription('Autoplay mode when queue ends')
            .setRequired(true)
            .addChoices(
              { name: 'Disabled', value: 'off' },
              { name: 'Similar tracks', value: 'similar' },
              { name: 'Same artist', value: 'artist' },
              { name: 'Same genre', value: 'genre' },
              { name: 'Mixed', value: 'mixed' }
            )
        )
    ),

  // Premium features management (comprehensive subscription and features)
  new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Access premium features and subscription management')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View your current subscription status and tier')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('plans')
        .setDescription('View all available subscription plans and pricing')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('upgrade')
        .setDescription('Upgrade to a higher subscription tier')
        .addStringOption(option =>
          option.setName('tier')
            .setDescription('Select subscription tier')
            .setRequired(true)
            .addChoices(
              { name: 'Basic - 10K tracks/month', value: 'basic' },
              { name: 'Premium - 100K tracks/month', value: 'premium' },
              { name: 'Enterprise - Unlimited', value: 'enterprise' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('features')
        .setDescription('View detailed features comparison for all tiers')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('usage')
        .setDescription('Check your current usage statistics and limits')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel your subscription (takes effect at period end)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('demo')
        .setDescription('Try premium features temporarily (test guilds only)')
    ),
];

async function registerCommands() {
  try {
    console.log('🔧 Starting Discord slash commands registration...');
    console.log(`📊 Total commands to register: ${commands.length}`);

    // Get environment variables directly
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
    const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
    const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

    if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
      throw new Error('Missing required environment variables: DISCORD_TOKEN and DISCORD_APPLICATION_ID');
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    // Convert commands to JSON
    const commandsJson = commands.map(command => command.toJSON());

    console.log('\n🎵 Commands to register:');
    commandsJson.forEach((cmd, index) => {
      console.log(`  ${index + 1}. /${cmd.name} - ${cmd.description}`);
    });

    // Register guild commands if DISCORD_GUILD_ID is set (for development)
    if (DISCORD_GUILD_ID) {
      console.log(`\n🏠 Registering guild commands for guild: ${DISCORD_GUILD_ID}`);
      const response = (await rest.put(
        Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID),
        { body: commandsJson }
      )) as unknown[];
      console.log('✅ Guild commands registered successfully!');
      console.log(`📊 Discord API returned ${response.length} registered commands`);
      console.log('💡 Guild commands appear instantly for testing');
    } else {
      // Register global commands (for production)
      console.log('\n🌍 Registering global commands...');
      const response = (await rest.put(
        Routes.applicationCommands(DISCORD_APPLICATION_ID),
        { body: commandsJson }
      )) as unknown[];
      console.log('✅ Global commands registered successfully!');
      console.log(`📊 Discord API returned ${response.length} registered commands`);
      console.log('⏳ Global commands may take up to 1 hour to appear in all servers');
    }

    console.log('\n🎉 Command registration completed!');
    console.log('\n📋 Command categories registered:');
    console.log('  🎵 Music Playback: /play, /playnext, /playnow');
    console.log('  ⏯️  Playback Control: /pause, /resume, /stop, /skip, /voteskip');
    console.log('  🔊 Audio Settings: /volume, /loop, /seek');
    console.log('  📋 Queue Management: /queue, /shuffle, /clear, /remove, /move');
    console.log('  📊 Information: /nowplaying');
    console.log('  🎸 Autoplay: /autoplay');
    console.log('  ⚙️  Server Settings: /settings (6 subcommands)');
    console.log('  ✨ Premium Features: /premium (7 subcommands)');

    console.log('\n🔗 Next steps:');
    console.log('  1. Restart Discord (Ctrl+R) to see new commands immediately');
    console.log('  2. Test commands in your Discord server');
    console.log('  3. Check gateway service logs for interaction handling');

  } catch (error) {
    console.error('❌ Error registering commands:', error);

    if (error instanceof Error) {
      if (error.message.includes('Invalid Form Body')) {
        console.error('💡 Tip: Check that all command names are lowercase and descriptions are valid');
      } else if (error.message.includes('401')) {
        console.error('💡 Tip: Check your DISCORD_TOKEN in .env file');
      } else if (error.message.includes('403')) {
        console.error('💡 Tip: Check your bot permissions and DISCORD_APPLICATION_ID');
      }
    }

    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⏸️  Command registration interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the registration
if (import.meta.url === `file://${process.argv[1]}`) {
  registerCommands();
}

export { registerCommands };