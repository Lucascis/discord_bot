/**
 * Cleanup Guild Slash Commands
 *
 * Purpose:
 * - Remove all guild-scoped application commands for the configured Discord guild.
 * - This is useful when you previously registered commands with `guild` / `both`
 *   scopes and then switched to `global`, which can cause duplicate commands to
 *   appear in Discord.
 *
 * Behavior:
 * - Uses DISCORD_TOKEN, DISCORD_APPLICATION_ID and DISCORD_GUILD_ID from env.
 * - Sends an empty array to the application guild commands route, effectively
 *   clearing all guild-level commands for this application in that guild.
 * - Global commands are not touched.
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !applicationId || !guildId) {
    console.error(
      'Missing required environment variables. Please ensure DISCORD_TOKEN, ' +
      'DISCORD_APPLICATION_ID and DISCORD_GUILD_ID are set in your .env file.',
    );
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  console.log('🔧 Cleaning up guild commands...');
  console.log(`  Application ID: ${applicationId}`);
  console.log(`  Guild ID      : ${guildId}`);

  try {
    // This replaces all guild commands with an empty array, effectively deleting them.
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: [],
    });

    console.log('✅ Guild commands cleared successfully.');
    console.log('   Only global commands (if any) will remain visible for this bot.');
  } catch (error) {
    console.error('❌ Failed to clear guild commands:', error);
    process.exit(1);
  }
}

main();

