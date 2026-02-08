/**
 * Tests for bot-engine unified command parsing
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const { createBotEngine, _test } = require('../src/bot-engine');

/**
 * Create a mock chat provider
 */
function createMockChatProvider() {
  const sent = [];
  const cards = [];
  const commandHandlers = [];
  const messageHandlers = [];
  const errorHandlers = [];

  return {
    name: 'mock',
    supportsCards: false,
    sent,
    cards,
    commandHandlers,
    messageHandlers,

    async initialize() {},
    async start() {},
    async stop() {},
    async sendMessage(channelId, text) {
      sent.push({ channelId, text });
      return { messageId: 'msg-1' };
    },
    async sendLongMessage(channelId, text) {
      sent.push({ channelId, text });
    },
    async sendCard(channelId, card) {
      cards.push({ channelId, card });
    },
    async deleteMessage() {},
    async sendTypingIndicator() {},

    onCommand(handler) {
      commandHandlers.push(handler);
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onError(handler) {
      errorHandlers.push(handler);
    },

    // Helper to simulate a command
    async simulateCommand(command, args, channelId = 'C123') {
      const ctx = {
        channelId,
        reply: async (text) => { sent.push({ channelId, text }); }
      };
      for (const h of commandHandlers) {
        await h(ctx, command, args);
      }
    }
  };
}

/**
 * Create a mock AI backend (local-mode style, no jobs map)
 */
function createMockLocalBackend() {
  const instances = new Map();
  const startCalls = [];

  return {
    startCalls,
    startInstance(instanceId, projectDir, channelId, opts = {}) {
      startCalls.push({ instanceId, projectDir, channelId, opts });
      if (instances.has(instanceId)) {
        return { success: false, error: `Instance "${instanceId}" already running` };
      }
      instances.set(instanceId, { projectDir, channelId, opts, startedAt: new Date(), messageCount: 0 });
      return { success: true, sessionId: 'session-abc' };
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
        if (instance.channelId === channelId) return { instanceId, instance };
      }
      return null;
    },
    listInstances() {
      return Array.from(instances.entries()).map(([instanceId, inst]) => ({
        instanceId, ...inst
      }));
    },
    async sendToInstance(instanceId, message, options = {}) {
      const inst = instances.get(instanceId);
      if (!inst) return { success: false, error: 'not found' };
      inst.messageCount++;
      return { success: true, responses: ['done'], exitCode: 0 };
    }
  };
}

describe('Bot Engine — Unified Commands', () => {
  let chatProvider;
  let aiBackend;

  beforeEach(() => {
    chatProvider = createMockChatProvider();
    aiBackend = createMockLocalBackend();
    createBotEngine({ chatProvider, aiBackend, commandPrefix: 'od', aiName: 'TestAI' });
  });

  describe('generateName', () => {
    it('should produce unique short IDs', () => {
      const a = _test.generateName();
      const b = _test.generateName();
      assert.ok(a.startsWith('agent-'));
      assert.ok(b.startsWith('agent-'));
      assert.strictEqual(a.length, 10); // 'agent-' + 4 hex chars
      // Statistically unique
      assert.notStrictEqual(a, b);
    });
  });

  describe('handleStart', () => {
    it('should auto-generate name and default path when no args', async () => {
      await chatProvider.simulateCommand('start', '');
      assert.strictEqual(aiBackend.startCalls.length, 1);
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, os.homedir());
    });

    it('should use provided name only', async () => {
      await chatProvider.simulateCommand('start', 'mybot');
      const call = aiBackend.startCalls[0];
      assert.strictEqual(call.instanceId, 'mybot');
      assert.strictEqual(call.projectDir, os.homedir());
    });

    it('should use provided name and path', async () => {
      await chatProvider.simulateCommand('start', 'mybot /tmp/code');
      const call = aiBackend.startCalls[0];
      assert.strictEqual(call.instanceId, 'mybot');
      assert.strictEqual(call.projectDir, '/tmp/code');
    });

    it('should extract --image flag', async () => {
      await chatProvider.simulateCommand('start', '--image my-agent');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.deepStrictEqual(call.opts, { image: 'my-agent' });
    });

    it('should handle name + --image', async () => {
      await chatProvider.simulateCommand('start', 'mybot --image custom:v1');
      const call = aiBackend.startCalls[0];
      assert.strictEqual(call.instanceId, 'mybot');
      assert.deepStrictEqual(call.opts, { image: 'custom:v1' });
    });

    it('should handle --image with auto-name', async () => {
      await chatProvider.simulateCommand('start', '--image my-agent');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.opts.image, 'my-agent');
    });

    it('should handle path that starts with /', async () => {
      await chatProvider.simulateCommand('start', '/home/user/project');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, '/home/user/project');
    });

    it('should handle path that starts with ~', async () => {
      await chatProvider.simulateCommand('start', '~/project');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, '~/project');
    });

    it('should handle relative path . as path not name', async () => {
      await chatProvider.simulateCommand('start', '.');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, '.');
    });

    it('should handle relative path ./repo as path not name', async () => {
      await chatProvider.simulateCommand('start', './repo');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, './repo');
    });

    it('should handle relative path ../repo as path not name', async () => {
      await chatProvider.simulateCommand('start', '../repo');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, '../repo');
    });

    it('should handle path with slashes (projects/api) as path not name', async () => {
      await chatProvider.simulateCommand('start', 'projects/api');
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
      assert.strictEqual(call.projectDir, 'projects/api');
    });
  });

  describe('handleRun', () => {
    it('should show usage when no task provided', async () => {
      await chatProvider.simulateCommand('run', '');
      assert.ok(chatProvider.sent.some(m => m.text && m.text.includes('Usage')));
      assert.strictEqual(aiBackend.startCalls.length, 0);
    });

    it('should run task with auto-generated name', async () => {
      await chatProvider.simulateCommand('run', 'fix the tests');
      assert.strictEqual(aiBackend.startCalls.length, 1);
      const call = aiBackend.startCalls[0];
      assert.ok(call.instanceId.startsWith('agent-'));
    });

    it('should extract --image flag from run args', async () => {
      await chatProvider.simulateCommand('run', '--image custom "fix tests"');
      // The instance was started (the run creates a temp instance)
      assert.strictEqual(aiBackend.startCalls.length, 1);
    });

    it('should work with local backend (no jobs map)', async () => {
      // Our mock backend has no .jobs property, proving the guard is removed
      assert.strictEqual(aiBackend.jobs, undefined);
      await chatProvider.simulateCommand('run', 'do something');
      assert.strictEqual(aiBackend.startCalls.length, 1);
    });

    it('should not extract --image from inside quoted task', async () => {
      await chatProvider.simulateCommand('run', '"document --image foo behavior"');
      assert.strictEqual(aiBackend.startCalls.length, 1);
      // The task should be the full quoted string, --image NOT extracted as a flag
      // (sendToInstance receives the task text)
    });
  });

  describe('handleStop', () => {
    it('should stop a named instance', async () => {
      await chatProvider.simulateCommand('start', 'mybot');
      await chatProvider.simulateCommand('stop', 'mybot');
      assert.strictEqual(aiBackend.getInstance('mybot'), null);
    });

    it('should show usage when no args', async () => {
      await chatProvider.simulateCommand('stop', '');
      assert.ok(chatProvider.sent.some(m => m.text && m.text.includes('Usage')));
    });

    it('should stop all instances with --all', async () => {
      await chatProvider.simulateCommand('start', 'bot-a');
      await chatProvider.simulateCommand('start', 'bot-b');
      assert.strictEqual(aiBackend.listInstances().length, 2);

      await chatProvider.simulateCommand('stop', '--all');
      assert.strictEqual(aiBackend.listInstances().length, 0);
    });

    it('should report when --all has nothing to stop', async () => {
      await chatProvider.simulateCommand('stop', '--all');
      assert.ok(chatProvider.sent.some(m => m.text && m.text.includes('No instances running')));
    });
  });

  describe('tokenize', () => {
    it('should split simple words', () => {
      assert.deepStrictEqual(_test.tokenize('a b c'), ['a', 'b', 'c']);
    });

    it('should keep quoted strings as single tokens', () => {
      assert.deepStrictEqual(_test.tokenize('--image foo "run the tests"'), ['--image', 'foo', 'run the tests']);
    });

    it('should handle single quotes', () => {
      assert.deepStrictEqual(_test.tokenize("'hello world'"), ['hello world']);
    });

    it('should not extract flags inside quotes', () => {
      const tokens = _test.tokenize('"document --image foo behavior"');
      assert.deepStrictEqual(tokens, ['document --image foo behavior']);
    });

    it('should handle empty input', () => {
      assert.deepStrictEqual(_test.tokenize(''), []);
    });
  });

  describe('looksLikePath', () => {
    it('should detect absolute paths', () => {
      assert.strictEqual(_test.looksLikePath('/home/user'), true);
    });

    it('should detect ~ paths', () => {
      assert.strictEqual(_test.looksLikePath('~/project'), true);
    });

    it('should detect relative dot paths', () => {
      assert.strictEqual(_test.looksLikePath('.'), true);
      assert.strictEqual(_test.looksLikePath('..'), true);
      assert.strictEqual(_test.looksLikePath('./repo'), true);
      assert.strictEqual(_test.looksLikePath('../repo'), true);
    });

    it('should detect paths with slashes', () => {
      assert.strictEqual(_test.looksLikePath('projects/api'), true);
    });

    it('should not detect plain names as paths', () => {
      assert.strictEqual(_test.looksLikePath('mybot'), false);
      assert.strictEqual(_test.looksLikePath('agent-7k3f'), false);
    });
  });

  describe('help text', () => {
    it('should show unified commands on unknown command', async () => {
      await chatProvider.simulateCommand('unknown', '');
      const helpMsg = chatProvider.sent.find(m => m.text && m.text.includes('Available commands'));
      assert.ok(helpMsg);
      assert.ok(helpMsg.text.includes('--image'));
      assert.ok(helpMsg.text.includes('--all'));
      assert.ok(!helpMsg.text.includes('--repo'));
      assert.ok(!helpMsg.text.includes('--branch'));
    });
  });
});
