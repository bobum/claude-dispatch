/**
 * Slack Chat Provider
 *
 * Implements the ChatProvider interface for Slack using @slack/bolt.
 * Uses Socket Mode for real-time messaging without needing a public endpoint.
 */

const { ChatProvider, registerProvider } = require('./chat-provider');

// @slack/bolt is imported dynamically to allow graceful handling if not installed
let App;

/**
 * Slack-specific configuration
 * @typedef {Object} SlackConfig
 * @property {string} token - Slack Bot Token (xoxb-...)
 * @property {string} signingSecret - Slack Signing Secret
 * @property {string} appToken - Slack App Token for Socket Mode (xapp-...)
 * @property {string} [commandPrefix='claude'] - Prefix for slash commands
 */

class SlackProvider extends ChatProvider {
  /**
   * @param {SlackConfig} config
   */
  constructor(config) {
    super(config);

    this.app = null;
    this._isInitialized = false;

    // Validate required config
    if (!config.token) {
      throw new Error('Slack provider requires token (SLACK_BOT_TOKEN)');
    }
    if (!config.signingSecret) {
      throw new Error('Slack provider requires signingSecret (SLACK_SIGNING_SECRET)');
    }
    if (!config.appToken) {
      throw new Error('Slack provider requires appToken (SLACK_APP_TOKEN)');
    }

    // Set defaults
    this.config = {
      commandPrefix: 'claude',
      ...config
    };
  }

  get name() {
    return 'slack';
  }

  get maxMessageLength() {
    return 3900; // Slack limit is 4000, leave buffer
  }

  get supportsCards() {
    return false; // Slack has blocks, but we'll use plain text for simplicity
  }

  get supportsEphemeral() {
    return true;
  }

  get supportsThreads() {
    return true;
  }

  /**
   * Initialize Slack app
   */
  async initialize() {
    if (this._isInitialized) return;

    // Dynamic import of @slack/bolt
    try {
      const bolt = require('@slack/bolt');
      App = bolt.App;
    } catch (error) {
      throw new Error(
        '@slack/bolt is not installed. Run: npm install @slack/bolt'
      );
    }

    // Create Slack app with Socket Mode
    this.app = new App({
      token: this.config.token,
      signingSecret: this.config.signingSecret,
      socketMode: true,
      appToken: this.config.appToken
    });

    // Setup event handlers
    this._setupEventHandlers();

    this._isInitialized = true;
    console.log('[Slack] Provider initialized');
  }

  /**
   * Setup Slack event handlers
   * @private
   */
  _setupEventHandlers() {
    const prefix = this.config.commandPrefix;

    // Message handler
    this.app.message(async ({ message, say }) => {
      // Ignore bot messages and message edits
      if (message.subtype || message.bot_id) {
        return;
      }

      const ctx = this._createContext({
        channelId: message.channel,
        userId: message.user,
        userName: null, // Would need additional API call to get username
        messageId: message.ts,
        raw: message
      });

      // Override reply for Slack context
      ctx.reply = async (text, options = {}) => {
        return this.sendMessage(message.channel, text, options);
      };

      await this._emitMessage(ctx, message.text || '');
    });

    // Slash command: start
    this.app.command(`/${prefix}-start`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'start', command.text || '');
    });

    // Slash command: stop
    this.app.command(`/${prefix}-stop`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'stop', command.text || '');
    });

    // Slash command: list
    this.app.command(`/${prefix}-list`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'list', '');
    });

    // Slash command: send
    this.app.command(`/${prefix}-send`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'send', command.text || '');
    });

    // Slash command: run (one-shot Sprite job)
    this.app.command(`/${prefix}-run`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'run', command.text || '');
    });

    // Slash command: jobs (list recent Sprite jobs)
    this.app.command(`/${prefix}-jobs`, async ({ command, ack, respond }) => {
      await ack();

      const ctx = this._createContext({
        channelId: command.channel_id,
        userId: command.user_id,
        userName: command.user_name,
        messageId: null,
        raw: command
      });

      ctx.reply = async (text) => respond(text);

      await this._emitCommand(ctx, 'jobs', '');
    });

    // Also support 'od-' prefix for consistency with other platforms
    if (prefix !== 'od') {
      this._setupAlternateCommands('od');
    }
  }

  /**
   * Setup alternate command prefix
   * @private
   */
  _setupAlternateCommands(altPrefix) {
    // start
    this.app.command(`/${altPrefix}-start`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'start', command.text || '');
    });

    // stop
    this.app.command(`/${altPrefix}-stop`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'stop', command.text || '');
    });

    // list
    this.app.command(`/${altPrefix}-list`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'list', '');
    });

    // send
    this.app.command(`/${altPrefix}-send`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'send', command.text || '');
    });

    // run
    this.app.command(`/${altPrefix}-run`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'run', command.text || '');
    });

    // jobs
    this.app.command(`/${altPrefix}-jobs`, async ({ command, ack, respond }) => {
      await ack();
      const ctx = this._createSlackContext(command, respond);
      await this._emitCommand(ctx, 'jobs', '');
    });
  }

  /**
   * Create context from Slack command
   * @private
   */
  _createSlackContext(command, respond) {
    const ctx = this._createContext({
      channelId: command.channel_id,
      userId: command.user_id,
      userName: command.user_name,
      messageId: null,
      raw: command
    });
    ctx.reply = async (text) => respond(text);
    return ctx;
  }

  /**
   * Start the Slack bot
   */
  async start() {
    if (!this._isInitialized) {
      await this.initialize();
    }

    await this.app.start();
    console.log('[Slack] Bot started (Socket Mode)');
  }

  /**
   * Stop the Slack bot
   */
  async stop() {
    if (this.app) {
      await this.app.stop();
      console.log('[Slack] Bot stopped');
    }
  }

  /**
   * Send a message to a Slack channel
   */
  async sendMessage(channelId, text, options = {}) {
    try {
      const chunks = this.chunkText(text);
      let lastMessageTs = null;

      for (const chunk of chunks) {
        const result = await this.app.client.chat.postMessage({
          channel: channelId,
          text: chunk,
          unfurl_links: false,
          unfurl_media: false,
          thread_ts: options.replyTo || undefined
        });
        lastMessageTs = result.ts;
      }

      return { messageId: lastMessageTs };
    } catch (error) {
      console.error('[Slack] Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Send typing indicator (Slack doesn't have a native typing indicator,
   * so we send a temporary "Thinking..." message)
   */
  async sendTypingIndicator(channelId) {
    // Slack doesn't have typing indicators for bots
    // The thinking message is handled by the bot engine
  }

  /**
   * Delete a message
   */
  async deleteMessage(channelId, messageId) {
    try {
      await this.app.client.chat.delete({
        channel: channelId,
        ts: messageId
      });
      return true;
    } catch (error) {
      console.error('[Slack] Failed to delete message:', error);
      return false;
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(channelId, messageId, newText) {
    try {
      await this.app.client.chat.update({
        channel: channelId,
        ts: messageId,
        text: newText
      });
      return true;
    } catch (error) {
      console.error('[Slack] Failed to edit message:', error);
      return false;
    }
  }

  /**
   * Post a temporary "Thinking..." message and return its ID for later deletion
   * @param {string} channelId
   * @returns {Promise<string|null>} Message timestamp or null
   */
  async postThinkingMessage(channelId) {
    try {
      const result = await this.app.client.chat.postMessage({
        channel: channelId,
        text: '_Thinking..._'
      });
      return result.ts;
    } catch (error) {
      console.error('[Slack] Failed to post thinking message:', error);
      return null;
    }
  }
}

// Register provider
registerProvider('slack', SlackProvider);

module.exports = { SlackProvider };
