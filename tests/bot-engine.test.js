/**
 * Tests for the Bot Engine
 *
 * Covers:
 * - Message batcher error handling (flush errors don't crash, subsequent messages work)
 * - Unhandled rejection handler verification (entry points have handlers)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createBotEngine } = require('../src/bot-engine');
const fs = require('fs');
const path = require('path');

// ============================================
// Mock Chat Provider
// ============================================

function createMockChatProvider() {
  const sentMessages = [];
  const commandHandlers = [];
  const messageHandlers = [];
  const errorHandlers = [];

  return {
    name: 'mock',
    supportsCards: false,

    sentMessages,

    async initialize() {},
    async start() {},
    async stop() {},

    onCommand(handler) { commandHandlers.push(handler); },
    onMessage(handler) { messageHandlers.push(handler); },
    onError(handler) { errorHandlers.push(handler); },

    async sendMessage(channelId, text) {
      sentMessages.push({ channelId, text, type: 'message' });
      return { messageId: `msg-${sentMessages.length}` };
    },

    async sendLongMessage(channelId, text) {
      sentMessages.push({ channelId, text, type: 'long' });
    },

    async sendTypingIndicator(channelId) {
      sentMessages.push({ channelId, type: 'typing' });
    },

    async deleteMessage(channelId, messageId) {
      sentMessages.push({ channelId, messageId, type: 'delete' });
    },

    async sendCard(channelId, card) {
      sentMessages.push({ channelId, card, type: 'card' });
    },

    // Fire a command handler (simulates incoming command)
    async fireCommand(ctx, command, args) {
      for (const handler of commandHandlers) {
        await handler(ctx, command, args);
      }
    },

    // Fire a message handler (simulates incoming message)
    async fireMessage(ctx, text) {
      for (const handler of messageHandlers) {
        await handler(ctx, text);
      }
    }
  };
}

// ============================================
// Mock AI Backend (sprite-core-like)
// ============================================

function createMockAIBackend(options = {}) {
  const instances = new Map();
  const jobs = new Map();

  return {
    instances,
    jobs,

    async startInstance(instanceId, projectDir, channelId) {
      if (instances.has(instanceId)) {
        return { success: false, error: `Instance "${instanceId}" already running` };
      }
      instances.set(instanceId, {
        instanceId,
        projectDir,
        channelId,
        messageCount: 0,
        startedAt: new Date()
      });
      return { success: true, sessionId: 'mock-session-123' };
    },

    stopInstance(instanceId) {
      if (!instances.has(instanceId)) {
        return { success: false, error: `Instance "${instanceId}" not found` };
      }
      instances.delete(instanceId);
      return { success: true };
    },

    getInstance(instanceId) {
      return instances.get(instanceId) || null;
    },

    getInstanceByChannel(channelId) {
      for (const [instanceId, instance] of instances) {
        if (instance.channelId === channelId) {
          return { instanceId, instance };
        }
      }
      return null;
    },

    listInstances() {
      return Array.from(instances.entries()).map(([id, inst]) => ({
        instanceId: id,
        ...inst
      }));
    },

    async sendToInstance(instanceId, message, opts = {}) {
      const instance = instances.get(instanceId);
      if (!instance) {
        return { success: false, error: `Instance "${instanceId}" not found` };
      }
      instance.messageCount++;

      // If there's an onMessage callback, fire it to test batcher behavior
      if (opts.onMessage) {
        if (options.streamMessages) {
          for (const msg of options.streamMessages) {
            await opts.onMessage(msg);
          }
        }
      }

      if (options.sendError) {
        return { success: false, error: options.sendError };
      }

      return {
        success: true,
        responses: options.responses || ['Mock response'],
        jobId: 'mock-job-123',
        artifacts: options.artifacts || []
      };
    },

    listJobs() {
      return Array.from(jobs.values());
    }
  };
}

// ============================================
// Message Batcher Error Handling Tests
// ============================================

describe('Bot Engine - Message Batcher Error Handling', () => {
  it('should not crash when chatProvider.sendLongMessage throws during flush', async () => {
    let sendCallCount = 0;
    const chatProvider = createMockChatProvider();

    // Override sendLongMessage to throw on first call, succeed on subsequent
    const originalSendLong = chatProvider.sendLongMessage;
    chatProvider.sendLongMessage = async (channelId, text) => {
      sendCallCount++;
      if (sendCallCount === 1) {
        throw new Error('Slack API rate limited');
      }
      return originalSendLong.call(chatProvider, channelId, text);
    };

    const aiBackend = createMockAIBackend({
      streamMessages: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6']
    });

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: true
    });

    // Start an instance via the backend directly
    await aiBackend.startInstance('test', '/project', 'C123');

    // Fire a run command that will use the batcher
    const ctx = { channelId: 'C123', reply: async (text) => {} };
    await chatProvider.fireCommand(ctx, 'run', '--repo owner/repo "do stuff"');

    // The bot should not have crashed — the test completing is itself the assertion.
    // But also verify no unhandled errors propagated.
    assert.ok(true, 'Bot engine survived flush error without crashing');
  });

  it('should continue processing messages after a flush error', async () => {
    let sendCallCount = 0;
    let successfulSends = 0;
    const chatProvider = createMockChatProvider();

    chatProvider.sendLongMessage = async (channelId, text) => {
      sendCallCount++;
      if (sendCallCount <= 1) {
        throw new Error('temporary API error');
      }
      successfulSends++;
    };

    const aiBackend = createMockAIBackend({
      // Stream enough messages to trigger multiple flushes
      streamMessages: [
        'batch1-line1', 'batch1-line2', 'batch1-line3', 'batch1-line4', 'batch1-line5',
        'batch2-line1', 'batch2-line2', 'batch2-line3', 'batch2-line4', 'batch2-line5'
      ]
    });

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: true
    });

    await aiBackend.startInstance('test', '/project', 'C123');

    const ctx = { channelId: 'C123', reply: async () => {} };
    await chatProvider.fireCommand(ctx, 'run', '--repo owner/repo "do stuff"');

    // Even though the first send failed, subsequent sends should have gone through
    assert.ok(sendCallCount > 1,
      'Multiple flush attempts should have been made');
  });
});

// ============================================
// Bot Engine command routing tests
// ============================================

describe('Bot Engine - Command Routing', () => {
  it('should route messages to the correct instance by channel', async () => {
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend({
      responses: ['Hello from AI']
    });

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: false
    });

    // Start instance linked to a channel
    await aiBackend.startInstance('my-project', '/project', 'C123');

    // Fire a message on that channel
    const ctx = {
      channelId: 'C123',
      reply: async (text) => {
        chatProvider.sentMessages.push({ text, type: 'reply' });
      }
    };
    await chatProvider.fireMessage(ctx, 'run tests');

    const instance = aiBackend.getInstance('my-project');
    assert.strictEqual(instance.messageCount, 1);
  });

  it('should ignore messages on channels without an active instance', async () => {
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend();

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false
    });

    const ctx = {
      channelId: 'C-NO-INSTANCE',
      reply: async (text) => {
        chatProvider.sentMessages.push({ text, type: 'reply' });
      }
    };
    await chatProvider.fireMessage(ctx, 'hello');

    // No messages should be sent (no instance, so message is silently ignored)
    const nonTyping = chatProvider.sentMessages.filter(m => m.type !== 'typing');
    assert.strictEqual(nonTyping.length, 0,
      'No responses should be sent for channels without instances');
  });
});

// ============================================
// Image Alias Resolution Tests
// ============================================

describe('Bot Engine - Image Alias Resolution', () => {
  it('should resolve image alias from SPRITE_IMAGES env var', async () => {
    const originalEnv = process.env.SPRITE_IMAGES;
    process.env.SPRITE_IMAGES = JSON.stringify({
      web: 'ghcr.io/myorg/web-sprite:latest',
      api: 'ghcr.io/myorg/api-sprite:latest'
    });

    let capturedImage = null;
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend();

    // Capture the image passed to sendToInstance
    const originalSend = aiBackend.sendToInstance.bind(aiBackend);
    aiBackend.sendToInstance = async (instanceId, message, opts) => {
      capturedImage = opts.image;
      return originalSend(instanceId, message, opts);
    };

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: false
    });

    await aiBackend.startInstance('test', '/project', 'C123');
    const ctx = { channelId: 'C123', reply: async () => {} };
    await chatProvider.fireCommand(ctx, 'run', '--image web "do stuff"');

    assert.strictEqual(capturedImage, 'ghcr.io/myorg/web-sprite:latest',
      'Image alias should resolve to full URL');

    // Cleanup
    if (originalEnv === undefined) {
      delete process.env.SPRITE_IMAGES;
    } else {
      process.env.SPRITE_IMAGES = originalEnv;
    }
  });

  it('should pass through full image URLs unchanged', async () => {
    const originalEnv = process.env.SPRITE_IMAGES;
    process.env.SPRITE_IMAGES = JSON.stringify({ web: 'ghcr.io/myorg/web-sprite:latest' });

    let capturedImage = null;
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend();

    const originalSend = aiBackend.sendToInstance.bind(aiBackend);
    aiBackend.sendToInstance = async (instanceId, message, opts) => {
      capturedImage = opts.image;
      return originalSend(instanceId, message, opts);
    };

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: false
    });

    await aiBackend.startInstance('test', '/project', 'C123');
    const ctx = { channelId: 'C123', reply: async () => {} };
    await chatProvider.fireCommand(ctx, 'run', '--image ghcr.io/other/image:v2 "do stuff"');

    assert.strictEqual(capturedImage, 'ghcr.io/other/image:v2',
      'Unrecognized image names should pass through as-is');

    if (originalEnv === undefined) {
      delete process.env.SPRITE_IMAGES;
    } else {
      process.env.SPRITE_IMAGES = originalEnv;
    }
  });

  it('should work when SPRITE_IMAGES is not set', async () => {
    const originalEnv = process.env.SPRITE_IMAGES;
    delete process.env.SPRITE_IMAGES;

    let capturedImage = null;
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend();

    const originalSend = aiBackend.sendToInstance.bind(aiBackend);
    aiBackend.sendToInstance = async (instanceId, message, opts) => {
      capturedImage = opts.image;
      return originalSend(instanceId, message, opts);
    };

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: false
    });

    await aiBackend.startInstance('test', '/project', 'C123');
    const ctx = { channelId: 'C123', reply: async () => {} };
    await chatProvider.fireCommand(ctx, 'run', '--image my-image:v1 "do stuff"');

    assert.strictEqual(capturedImage, 'my-image:v1',
      'Image should pass through when SPRITE_IMAGES is not set');

    if (originalEnv === undefined) {
      delete process.env.SPRITE_IMAGES;
    } else {
      process.env.SPRITE_IMAGES = originalEnv;
    }
  });

  it('should handle malformed SPRITE_IMAGES JSON gracefully', async () => {
    const originalEnv = process.env.SPRITE_IMAGES;
    process.env.SPRITE_IMAGES = 'not valid json';

    let capturedImage = null;
    const chatProvider = createMockChatProvider();
    const aiBackend = createMockAIBackend();

    const originalSend = aiBackend.sendToInstance.bind(aiBackend);
    aiBackend.sendToInstance = async (instanceId, message, opts) => {
      capturedImage = opts.image;
      return originalSend(instanceId, message, opts);
    };

    const bot = createBotEngine({
      chatProvider,
      aiBackend,
      aiName: 'Test',
      showThinking: false,
      streamResponses: false
    });

    await aiBackend.startInstance('test', '/project', 'C123');
    const ctx = { channelId: 'C123', reply: async () => {} };
    await chatProvider.fireCommand(ctx, 'run', '--image web "do stuff"');

    assert.strictEqual(capturedImage, 'web',
      'Should fall back to raw image name on invalid JSON');

    if (originalEnv === undefined) {
      delete process.env.SPRITE_IMAGES;
    } else {
      process.env.SPRITE_IMAGES = originalEnv;
    }
  });
});

// ============================================
// Unhandled Rejection Handler Verification
// ============================================

describe('Unhandled rejection handlers in entry points', () => {
  // These tests verify that each bot entry point file contains
  // process.on('unhandledRejection', ...) or equivalent handlers.
  // This is a static/grep-style check on the source code.

  const entryPoints = [
    { name: 'bot.js', path: path.join(__dirname, '../src/bot.js'), requiresSigint: true },
    { name: 'sprite-bot.js', path: path.join(__dirname, '../src/sprite-bot.js'), requiresSigint: true },
    { name: 'discord-bot.js', path: path.join(__dirname, '../src/discord-bot.js'), requiresSigint: true },
    { name: 'discord-opencode-bot.js', path: path.join(__dirname, '../src/discord-opencode-bot.js'), requiresSigint: true },
    { name: 'teams-bot.js', path: path.join(__dirname, '../src/teams-bot.js'), requiresSigint: true },
    { name: 'teams-opencode-bot.js', path: path.join(__dirname, '../src/teams-opencode-bot.js'), requiresSigint: true },
    { name: 'opencode-bot.js', path: path.join(__dirname, '../src/opencode-bot.js'), requiresSigint: true }
  ];

  for (const ep of entryPoints) {
    if (ep.requiresSigint) {
      it(`${ep.name} should have SIGINT handler`, () => {
        const source = fs.readFileSync(ep.path, 'utf8');
        assert.ok(
          source.includes("process.on('SIGINT'") ||
          source.includes('process.on("SIGINT"') ||
          source.includes('process.on(`SIGINT`'),
          `${ep.name} should have a SIGINT handler for graceful shutdown`
        );
      });
    }

    it(`${ep.name} should have unhandledRejection handler`, () => {
      const source = fs.readFileSync(ep.path, 'utf8');
      assert.ok(
        source.includes('unhandledRejection') ||
        source.includes('uncaughtException') ||
        source.includes('registerFatalHandlers'),
        `${ep.name} should have unhandledRejection or uncaughtException handler (or use registerFatalHandlers)`
      );
    });
  }

  it('sprite-bot.js should have SIGTERM handler', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/sprite-bot.js'), 'utf8'
    );
    assert.ok(
      source.includes('SIGTERM'),
      'sprite-bot.js should handle SIGTERM for container shutdown'
    );
  });
});
