import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { env } from '@discord-bot/config';
import { logger } from '@discord-bot/logger';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  logger.info(`Logged in as ${client.user?.tag}`);
});

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with pong!'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

async function main() {
  // Application ID debe configurarse; se usa 0 como placeholder
  await rest.put(Routes.applicationCommands('0'), { body: commands });
  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => logger.error(err));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});
