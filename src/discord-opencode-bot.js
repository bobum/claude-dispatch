/**
 * Discord Bot with OpenCode Backend
 *
 * This bot connects Discord to OpenCode CLI, supporting 75+ AI providers.
 * For Claude-only support, use discord-bot.js instead.
 *
 * Environment variables required:
 *   DISCORD_BOT_TOKEN - Discord bot token
 *   DISCORD_CLIENT_ID - Discord application client ID
 *   DISCORD_GUILD_ID  - (Optional) Guild ID for faster slash command registration
 *   OPENCODE_MODEL    - (Optional) Model override (e.g., anthropic/claude-sonnet-4)
 *   OPENCODE_PATH     - (Optional) Path to opencode binary if not in PATH
 *
 * Usage:
 *   npm run start:discord:opencode
 *   # or
 *   node src/discord-opencode-bot.js
 */

const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { DiscordProvider } = require('./providers/discord-provider');
const { createBotEngine } = require('./bot-engine');
const { createInstanceManager } = require('./opencode-core');

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

// Create OpenCode instance manager with optional model override
const instanceManager = createInstanceManager({
  model: process.env.OPENCODE_MODEL || null
});

// Create bot engine
const bot = createBotEngine({
  chatProvider: discordProvider,
  aiBackend: instanceManager,
  commandPrefix: 'od',
  aiName: 'OpenCode',
  showThinking: true,
  streamResponses: true
});

// Start the bot
(async () => {
  try {
    await bot.start();
    console.log('');
    console.log('OpenCode Dispatch (Discord) is running');
    console.log('Backend: OpenCode CLI');
    if (process.env.OPENCODE_MODEL) {
      console.log(`Model: ${process.env.OPENCODE_MODEL}`);
    }
    console.log('');
    console.log('Commands:');
    console.log('  /od-start <name> <path> - Start an OpenCode instance');
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
