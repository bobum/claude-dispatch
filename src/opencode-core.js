/**
 * OpenCode Core Module
 *
 * Contains the core logic for OpenCode integration, separated from Slack
 * for testability.
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

/**
 * Create an instance manager
 * @param {Object} options
 * @param {string} [options.model] - Optional model override
 * @param {Function} [options.spawnFn] - Optional spawn function for testing
 * @returns {Object} Instance manager with methods
 */
function createInstanceManager(options = {}) {
  const instances = new Map();
  const model = options.model || null;
  const spawnFn = options.spawnFn || spawn;

  /**
   * Start a new OpenCode instance
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
   * Stop an OpenCode instance
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
   * Send a message to an OpenCode instance
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

    const args = ['run', '--format', 'json'];

    if (!isFirstMessage) {
      args.push('--session', instance.sessionId);
    }

    if (model) {
      args.push('-m', model);
    }

    args.push('--', message);

    return new Promise((resolve) => {
      const opencodePath = process.env.OPENCODE_PATH || 'opencode';
      
      const proc = spawnFn(opencodePath, args, {
        cwd: instance.projectDir,
        shell: false,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      const streamedTexts = new Set();

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        if (onMessage) {
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              const text = extractEventText(event);
              if (text && !streamedTexts.has(text)) {
                streamedTexts.add(text);
                onMessage(text).catch(err => {
                  console.error('[OpenCode] Error in onMessage callback:', err);
                });
              }
              if (event.sessionID || event.sessionId || event.session_id) {
                instance.sessionId = event.sessionID || event.sessionId || event.session_id;
              }
            } catch (e) {
              // NDJSON parse error - partial line will be completed on next chunk
            }
          }
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (onMessage && lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer);
            const text = extractEventText(event);
            if (text && !streamedTexts.has(text)) {
              streamedTexts.add(text);
              onMessage(text).catch(err => {
                console.error('[OpenCode] Error in onMessage callback:', err);
              });
            }
          } catch (e) {
            // NDJSON final buffer parse error
          }
        }

        const responses = parseOpenCodeOutput(stdout);

        if (isFirstMessage && responses.sessionId) {
          instance.sessionId = responses.sessionId;
        }

        const finalTexts = streamedTexts.size > 0 ? [...streamedTexts] : responses.texts;
        resolve({ success: true, responses: finalTexts, exitCode: code, streamed: streamedTexts.size > 0 });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Build CLI arguments for OpenCode
   */
  function buildArgs(message, projectDir, sessionId, isFirstMessage) {
    const args = ['run', '--format', 'json'];

    if (!isFirstMessage) {
      args.push('--session', sessionId);
    }

    if (model) {
      args.push('-m', model);
    }

    args.push('--', message);

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
 * Parse OpenCode's JSON output
 */
function parseOpenCodeOutput(output) {
  const result = { texts: [], sessionId: null };

  if (!output || !output.trim()) {
    return result;
  }

  try {
    const json = JSON.parse(output);

    // Handle assistant event type (single JSON object)
    if (json.type === 'assistant' && json.message?.content) {
      const text = extractTextContent(json.message.content);
      if (text) result.texts.push(text);
    } else if (json.response) {
      result.texts.push(json.response);
    } else if (json.content) {
      const text = extractTextContent(json.content);
      if (text) result.texts.push(text);
    } else if (json.message) {
      result.texts.push(typeof json.message === 'string' ? json.message : JSON.stringify(json.message));
    } else if (typeof json === 'string') {
      result.texts.push(json);
    } else {
      result.texts.push(JSON.stringify(json, null, 2));
    }

    if (json.sessionId || json.session_id) {
      result.sessionId = json.sessionId || json.session_id;
    }
  } catch (e) {
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const text = extractEventText(event);
        if (text) {
          result.texts.push(text);
        }
        if (event.sessionID || event.sessionId || event.session_id) {
          result.sessionId = event.sessionID || event.sessionId || event.session_id;
        }
      } catch (lineErr) {
        if (line.trim() && !line.startsWith('[') && !line.includes('spinner')) {
          result.texts.push(line);
        }
      }
    }
  }

  if (result.texts.length === 0 && output.trim()) {
    result.texts.push(output.trim());
  }

  return result;
}

/**
 * Extract text from OpenCode event object
 */
function extractEventText(event) {
  if (event.type === 'text' && event.part?.text) {
    return event.part.text;
  }
  if (event.type === 'assistant' && event.message?.content) {
    return extractTextContent(event.message.content);
  }
  if (event.type === 'response' && event.text) {
    return event.text;
  }
  if (event.type === 'text' && event.content) {
    return event.content;
  }
  if (event.response) {
    return event.response;
  }
  if (event.output) {
    return event.output;
  }
  return null;
}

/**
 * Extract text content from content blocks
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
 * Chunk text for Slack's message limit
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
  parseOpenCodeOutput,
  extractEventText,
  extractTextContent,
  chunkText
};
