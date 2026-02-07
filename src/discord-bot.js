/**
 * Discord Bot with Claude Code Backend
 *
 * This bot connects Discord to Claude Code CLI.
 * For OpenCode support (75+ AI providers), use discord-opencode-bot.js instead.
 *
 * Environment variables required:
 *   DISCORD_BOT_TOKEN - Discord bot token
 *   DISCORD_CLIENT_ID - Discord application client ID
 *   DISCORD_GUILD_ID  - (Optional) Guild ID for faster slash command registration
 *
 * Usage:
 *   npm run start:discord
 *   # or
 *   node src/discord-bot.js
 */

const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { DiscordProvider } = require('./providers/discord-provider');
const { createBotEngine } = require('./bot-engine');
const { createInstanceManager } = require('./claude-core');

// Validate environment
if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN environment variable is required');
  console.error('See DISCORD_SETUP.md for configuration instructions');
  process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID) {
  console.error('Error: DISCORD_CLIENT_ID environment variable is required');
  console.error('See DISCORD_SETUP.md for configuration instructions');
  process.exit(1);
}

// Create Discord provider
const discordProvider = new DiscordProvider({
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,
  commandPrefix: 'od',
  useSlashCommands: true,
  useTextCommands: true
});

// Create Claude Code instance manager
const instanceManager = createInstanceManager();

// Create bot engine
const bot = createBotEngine({
  chatProvider: discordProvider,
  aiBackend: instanceManager,
  commandPrefix: 'od',
  aiName: 'Claude',
  showThinking: true,
  streamResponses: true
});

// Start the bot
(async () => {
  try {
    await bot.start();
    console.log('');
    console.log('Claude Dispatch (Discord) is running');
    console.log('Backend: Claude Code CLI');
    console.log('');
    console.log('Commands:');
    console.log('  /od-start <name> <path> - Start a Claude instance');
    console.log('  /od-stop <name>         - Stop an instance');
    console.log('  /od-list                - List running instances');
    console.log('  /od-send <name> <msg>   - Send to specific instance');
    console.log('');
    console.log('Or use text commands: od-start, od-stop, od-list, od-send');
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await bot.stop();
  process.exit(0);
});
