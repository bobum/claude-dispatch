/**
 * Claude Core Module
 *
 * Contains the core logic for Claude Code CLI integration, separated from
 * the bot implementation for testability and reusability.
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');

/**
 * Create an instance manager for Claude Code
 * @param {Object} options
 * @param {Function} [options.spawnFn] - Optional spawn function for testing
 * @returns {Object} Instance manager with methods
 */
function createInstanceManager(options = {}) {
  const instances = new Map();
  const spawnFn = options.spawnFn || spawn;

  /**
   * Start a new Claude Code instance
   */
  function startInstance(instanceId, projectDir, channel) {
    if (instances.has(instanceId)) {
      return { success: false, error: `Instance "${instanceId}" already running` };
    }

    const sessionId = randomUUID();

    instances.set(instanceId, {
      sessionId,
      channel,
      projectDir,
      messageCount: 0,
      startedAt: new Date()
    });

    return { success: true, sessionId };
  }

  /**
   * Stop a Claude Code instance
   */
  function stopInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    instances.delete(instanceId);
    return { success: true };
  }

  /**
   * Get an instance by ID
   */
  function getInstance(instanceId) {
    return instances.get(instanceId) || null;
  }

  /**
   * Find instance by channel
   */
  function getInstanceByChannel(channelId) {
    for (const [instanceId, instance] of instances) {
      if (instance.channel === channelId) {
        return { instanceId, instance };
      }
    }
    return null;
  }

  /**
   * List all instances
   */
  function listInstances() {
    return Array.from(instances.entries()).map(([instanceId, instance]) => ({
      instanceId,
      ...instance
    }));
  }

  /**
   * Clear all instances (useful for testing)
   */
  function clearInstances() {
    instances.clear();
  }

  /**
   * Send a message to a Claude Code instance
   * @param {string} instanceId - Instance ID
   * @param {string} message - Message to send
   * @param {Object} options - Optional settings
   * @param {Function} [options.onMessage] - Callback for streaming messages: (text: string) => Promise<void>
   * @returns {Promise<Object>} Result with success, responses, exitCode
   */
  async function sendToInstance(instanceId, message, options = {}) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    const { onMessage } = options;
    const isFirstMessage = instance.messageCount === 0;
    instance.messageCount++;

    const args = [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose'
    ];

    if (isFirstMessage) {
      args.push('--session-id', instance.sessionId);
    } else {
      args.push('--resume', instance.sessionId);
    }

    return new Promise((resolve) => {
      const proc = spawnFn('claude', args, {
        cwd: instance.projectDir,
        shell: true,
        env: { ...process.env }
      });

      const rl = readline.createInterface({ input: proc.stdout });
      const responses = [];
      let streamed = false;

      rl.on('line', (line) => {
        try {
          const event = JSON.parse(line);

          if (event.type === 'assistant' && event.message?.content) {
            const text = extractTextContent(event.message.content);
            if (text) {
              responses.push(text);
              if (onMessage) {
                streamed = true;
                onMessage(text).catch(err => {
                  console.error('[Claude] Error in onMessage callback:', err);
                });
              }
            }
          }
        } catch (e) {
          // JSON parse error
        }
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('Error') || msg.includes('write')) {
          return;
        }
        console.error(`[${instanceId}] stderr: ${msg}`);
      });

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[${instanceId}] exited with code ${code}`);
        }
        resolve({ success: true, responses, exitCode: code, streamed });
      });

      proc.on('error', (err) => {
        console.error(`[${instanceId}] failed to spawn:`, err);
        resolve({ success: false, error: err.message });
      });

      const input = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: message
        }
      });

      proc.stdin.write(input + '\n');
      proc.stdin.end();
    });
  }

  /**
   * Build CLI arguments for Claude
   */
  function buildArgs(sessionId, isFirstMessage) {
    const args = [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose'
    ];

    if (isFirstMessage) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }

    return args;
  }

  return {
    startInstance,
    stopInstance,
    getInstance,
    getInstanceByChannel,
    listInstances,
    clearInstances,
    sendToInstance,
    buildArgs,
    get instances() { return instances; }
  };
}

/**
 * Extract text content from Claude's content blocks
 */
function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text' || typeof block === 'string')
      .map(block => typeof block === 'string' ? block : block.text)
      .join('\n');
  }
  if (content && content.text) {
    return content.text;
  }
  return null;
}

/**
 * Chunk text for message limits
 * @param {string} text - Text to chunk
 * @param {number} maxLength - Maximum chunk length (default 3900 for Slack, 25000 for Teams)
 */
function chunkText(text, maxLength = 3900) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}

module.exports = {
  createInstanceManager,
  extractTextContent,
  chunkText
};
