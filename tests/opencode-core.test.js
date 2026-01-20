const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createInstanceManager,
  parseOpenCodeOutput,
  extractEventText,
  extractTextContent,
  chunkText
} = require('../src/opencode-core');

const EventEmitter = require('events');

// Mock spawn function for testing
function createMockSpawn(mockOutput = '', mockStderr = '', exitCode = 0) {
  return function mockSpawn(command, args, options) {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    setImmediate(() => {
      if (mockOutput) {
        proc.stdout.emit('data', Buffer.from(mockOutput));
      }
      if (mockStderr) {
        proc.stderr.emit('data', Buffer.from(mockStderr));
      }
      proc.emit('close', exitCode);
    });

    return proc;
  };
}

describe('Instance Manager', () => {
  let manager;

  beforeEach(() => {
    manager = createInstanceManager();
  });

  describe('startInstance', () => {
    it('should create a new instance', () => {
      const result = manager.startInstance('test-instance', '/path/to/project', 'channel-123');

      assert.strictEqual(result.success, true);
      assert.ok(result.sessionId);
      assert.strictEqual(typeof result.sessionId, 'string');
    });

    it('should fail if instance already exists', () => {
      manager.startInstance('test-instance', '/path/to/project', 'channel-123');
      const result = manager.startInstance('test-instance', '/path/to/project', 'channel-456');

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('already running'));
    });

    it('should store instance data correctly', () => {
      manager.startInstance('my-project', '/home/user/project', 'C123');

      const instance = manager.getInstance('my-project');
      assert.ok(instance !== null);
      assert.strictEqual(instance.projectDir, '/home/user/project');
      assert.strictEqual(instance.channel, 'C123');
      assert.strictEqual(instance.messageCount, 0);
      assert.ok(instance.startedAt instanceof Date);
    });
  });

  describe('stopInstance', () => {
    it('should stop an existing instance', () => {
      manager.startInstance('test-instance', '/path', 'channel');
      const result = manager.stopInstance('test-instance');

      assert.strictEqual(result.success, true);
      assert.strictEqual(manager.getInstance('test-instance'), null);
    });

    it('should fail if instance does not exist', () => {
      const result = manager.stopInstance('nonexistent');

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('not found'));
    });
  });

  describe('getInstanceByChannel', () => {
    it('should find instance by channel', () => {
      manager.startInstance('project-a', '/path/a', 'channel-A');
      manager.startInstance('project-b', '/path/b', 'channel-B');

      const found = manager.getInstanceByChannel('channel-B');

      assert.ok(found !== null);
      assert.strictEqual(found.instanceId, 'project-b');
    });

    it('should return null if no instance found', () => {
      manager.startInstance('project-a', '/path/a', 'channel-A');

      const found = manager.getInstanceByChannel('channel-X');

      assert.strictEqual(found, null);
    });
  });

  describe('listInstances', () => {
    it('should return empty array when no instances', () => {
      const list = manager.listInstances();
      assert.deepStrictEqual(list, []);
    });

    it('should return all instances', () => {
      manager.startInstance('project-a', '/path/a', 'channel-A');
      manager.startInstance('project-b', '/path/b', 'channel-B');

      const list = manager.listInstances();

      assert.strictEqual(list.length, 2);
      assert.ok(list.map(i => i.instanceId).includes('project-a'));
      assert.ok(list.map(i => i.instanceId).includes('project-b'));
    });
  });

  describe('buildArgs', () => {
    it('should build basic args for first message', () => {
      const args = manager.buildArgs('Hello', '/project', 'session-123', true);

      assert.ok(args.includes('run'));
      assert.ok(args.includes('--format'));
      assert.ok(args.includes('json'));
      assert.ok(args.includes('--'));
      assert.ok(args.includes('Hello'));
      assert.ok(!args.includes('--session'));
    });

    it('should include session flag for subsequent messages', () => {
      const args = manager.buildArgs('Hello', '/project', 'session-123', false);

      assert.ok(args.includes('--session'));
      assert.ok(args.includes('session-123'));
    });

    it('should include model flag when configured', () => {
      const managerWithModel = createInstanceManager({ model: 'openai/gpt-4o' });
      const args = managerWithModel.buildArgs('Hello', '/project', 'session-123', true);

      assert.ok(args.includes('-m'));
      assert.ok(args.includes('openai/gpt-4o'));
    });
  });
});

describe('sendToInstance', () => {
  it('should send message and return response', async () => {
    const mockOutput = JSON.stringify({ response: 'Hello from OpenCode!' });
    const manager = createInstanceManager({
      spawnFn: createMockSpawn(mockOutput)
    });

    manager.startInstance('test', '/project', 'channel');
    const result = await manager.sendToInstance('test', 'Hello');

    assert.strictEqual(result.success, true);
    assert.ok(result.responses.includes('Hello from OpenCode!'));
  });

  it('should fail for nonexistent instance', async () => {
    const manager = createInstanceManager();
    const result = await manager.sendToInstance('nonexistent', 'Hello');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('not found'));
  });

  it('should increment message count', async () => {
    const mockOutput = JSON.stringify({ response: 'OK' });
    const manager = createInstanceManager({
      spawnFn: createMockSpawn(mockOutput)
    });

    manager.startInstance('test', '/project', 'channel');

    await manager.sendToInstance('test', 'First');
    assert.strictEqual(manager.getInstance('test').messageCount, 1);

    await manager.sendToInstance('test', 'Second');
    assert.strictEqual(manager.getInstance('test').messageCount, 2);
  });

  it('should handle spawn errors', async () => {
    const errorSpawn = function() {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();

      setImmediate(() => {
        proc.emit('error', new Error('Command not found'));
      });

      return proc;
    };

    const manager = createInstanceManager({ spawnFn: errorSpawn });
    manager.startInstance('test', '/project', 'channel');

    const result = await manager.sendToInstance('test', 'Hello');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Command not found'));
  });
});

describe('parseOpenCodeOutput', () => {
  it('should handle empty output', () => {
    assert.deepStrictEqual(parseOpenCodeOutput(''), { texts: [], sessionId: null });
    assert.deepStrictEqual(parseOpenCodeOutput('   '), { texts: [], sessionId: null });
    assert.deepStrictEqual(parseOpenCodeOutput(null), { texts: [], sessionId: null });
  });

  it('should parse JSON with response field', () => {
    const output = JSON.stringify({ response: 'Hello world' });
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('Hello world'));
  });

  it('should parse JSON with content field', () => {
    const output = JSON.stringify({ content: 'Content text' });
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('Content text'));
  });

  it('should parse JSON with message field (string)', () => {
    const output = JSON.stringify({ message: 'Message text' });
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('Message text'));
  });

  it('should parse JSON with message field (object)', () => {
    const output = JSON.stringify({ message: { key: 'value' } });
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts[0].includes('key'));
  });

  it('should extract sessionId from response', () => {
    const output = JSON.stringify({ response: 'OK', sessionId: 'abc-123' });
    const result = parseOpenCodeOutput(output);

    assert.strictEqual(result.sessionId, 'abc-123');
  });

  it('should extract session_id (snake_case)', () => {
    const output = JSON.stringify({ response: 'OK', session_id: 'def-456' });
    const result = parseOpenCodeOutput(output);

    assert.strictEqual(result.sessionId, 'def-456');
  });

  it('should handle nd-JSON (newline-delimited)', () => {
    const output = [
      JSON.stringify({ type: 'response', text: 'First line' }),
      JSON.stringify({ type: 'response', text: 'Second line' })
    ].join('\n');

    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('First line'));
    assert.ok(result.texts.includes('Second line'));
  });

  it('should handle assistant event type', () => {
    const output = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello from assistant' }
        ]
      }
    });

    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('Hello from assistant'));
  });

  it('should fallback to raw output for unknown structure', () => {
    const output = JSON.stringify({ unknownField: 'data' });
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts[0].includes('unknownField'));
  });

  it('should handle plain text fallback', () => {
    const output = 'Plain text response';
    const result = parseOpenCodeOutput(output);

    assert.ok(result.texts.includes('Plain text response'));
  });

  it('should filter spinner lines', () => {
    const output = 'spinner loading\nActual response';
    const result = parseOpenCodeOutput(output);

    assert.ok(!result.texts.some(t => t.includes('spinner')));
    assert.ok(result.texts.includes('Actual response'));
  });
});

describe('extractEventText', () => {
  it('should extract from assistant type', () => {
    const event = {
      type: 'assistant',
      message: { content: 'Assistant message' }
    };
    assert.strictEqual(extractEventText(event), 'Assistant message');
  });

  it('should extract from response type', () => {
    const event = { type: 'response', text: 'Response text' };
    assert.strictEqual(extractEventText(event), 'Response text');
  });

  it('should extract from text type', () => {
    const event = { type: 'text', content: 'Text content' };
    assert.strictEqual(extractEventText(event), 'Text content');
  });

  it('should extract from response field', () => {
    const event = { response: 'Direct response' };
    assert.strictEqual(extractEventText(event), 'Direct response');
  });

  it('should extract from output field', () => {
    const event = { output: 'Output text' };
    assert.strictEqual(extractEventText(event), 'Output text');
  });

  it('should return null for unrecognized event', () => {
    const event = { unknown: 'field' };
    assert.strictEqual(extractEventText(event), null);
  });
});

describe('extractTextContent', () => {
  it('should return string as-is', () => {
    assert.strictEqual(extractTextContent('Hello'), 'Hello');
  });

  it('should extract from content blocks array', () => {
    const content = [
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' }
    ];
    assert.strictEqual(extractTextContent(content), 'First\nSecond');
  });

  it('should filter non-text blocks', () => {
    const content = [
      { type: 'text', text: 'Text block' },
      { type: 'tool_use', name: 'some_tool' }
    ];
    assert.strictEqual(extractTextContent(content), 'Text block');
  });

  it('should handle string items in array', () => {
    const content = ['First', 'Second'];
    assert.strictEqual(extractTextContent(content), 'First\nSecond');
  });

  it('should extract from object with text field', () => {
    const content = { text: 'Object text' };
    assert.strictEqual(extractTextContent(content), 'Object text');
  });

  it('should return null for unrecognized content', () => {
    assert.strictEqual(extractTextContent({ unknown: 'field' }), null);
    assert.strictEqual(extractTextContent(null), null);
  });
});

describe('chunkText', () => {
  it('should return single chunk for short text', () => {
    const chunks = chunkText('Hello world', 100);
    assert.deepStrictEqual(chunks, ['Hello world']);
  });

  it('should split long text at newlines', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const chunks = chunkText(text, 10);

    assert.ok(chunks.length > 1);
    chunks.forEach(chunk => {
      assert.ok(chunk.length <= 10);
    });
  });

  it('should split at spaces if no newline found', () => {
    const text = 'Word1 Word2 Word3 Word4';
    const chunks = chunkText(text, 12);

    assert.ok(chunks.length > 1);
  });

  it('should hard split if no break point found', () => {
    const text = 'AAAAAAAAAABBBBBBBBBB';
    const chunks = chunkText(text, 10);

    assert.deepStrictEqual(chunks, ['AAAAAAAAAA', 'BBBBBBBBBB']);
  });

  it('should use default max length', () => {
    const shortText = 'Short';
    const chunks = chunkText(shortText);

    assert.deepStrictEqual(chunks, ['Short']);
  });

  it('should handle empty text', () => {
    const chunks = chunkText('', 100);
    assert.deepStrictEqual(chunks, []);
  });
});
