import { REST, Routes, SlashCommandBuilder } from 'discord.js';

// Use environment variables directly without config package validation to avoid circular dependency
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;

if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
  console.error('Missing required environment variables:');
  if (!DISCORD_TOKEN) console.error('- DISCORD_TOKEN');
  if (!DISCORD_APPLICATION_ID) console.error('- DISCORD_APPLICATION_ID');
  console.error('\nPlease check your .env file.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add it to the queue')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('YouTube URL, search query, or direct URL')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused track'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume level (0-100)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode for the current track or queue')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Loop mode')
        .setRequired(false)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' }
        )
    ),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display the current music queue'),

  new SlashCommandBuilder()
    .setName('subscription')
    .setDescription('View your subscription status'),

  new SlashCommandBuilder()
    .setName('upgrade')
    .setDescription('Upgrade to premium subscription')
].map(command => command.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

async function deployCommands() {
  try {
    console.log('Started refreshing application (/) commands.');

    // Register commands for a specific guild (immediate sync)
    const GUILD_ID = "375086837103984650"; // Replace with your server ID
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, GUILD_ID),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error deploying commands:', error);
  }
}

deployCommands();