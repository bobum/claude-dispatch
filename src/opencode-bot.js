const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { App } = require('@slack/bolt');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

// Initialize Slack app with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Track instances: instanceId → { sessionId, channel, projectDir, messageCount }
const instances = new Map();

// Optional model override from environment
const OPENCODE_MODEL = process.env.OPENCODE_MODEL;

/**
 * Start a new OpenCode instance (creates session, doesn't spawn persistent process)
 */
function startInstance(instanceId, projectDir, slackChannel) {
  if (instances.has(instanceId)) {
    return { success: false, error: `Instance "${instanceId}" already running` };
  }

  instances.set(instanceId, {
    sessionId: null,  // Will be set from first OpenCode response
    channel: slackChannel,
    projectDir,
    messageCount: 0,
    startedAt: new Date()
  });

  console.log(`[${instanceId}] created instance in ${projectDir}`);
  return { success: true };
}

/**
 * Send a message to an OpenCode instance (spawns process, waits for response)
 */
async function sendToInstance(instanceId, message) {
  const instance = instances.get(instanceId);
  if (!instance) {
    return { success: false, error: `Instance "${instanceId}" not found` };
  }

  const isFirstMessage = instance.messageCount === 0;
  instance.messageCount++;

  // Build command args for OpenCode
  // opencode run --format json [--session <id>] [-m model] -- <message>
  const args = ['run', '--format', 'json'];

  // Add session continuation for subsequent messages (only if we have a valid session ID)
  if (!isFirstMessage && instance.sessionId) {
    args.push('--session', instance.sessionId);
  }

  // Add model override if specified
  if (OPENCODE_MODEL) {
    args.push('-m', OPENCODE_MODEL);
  }

  args.push('--', message);

  return new Promise((resolve) => {
    const proc = spawn('opencode', args, {
      cwd: instance.projectDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[${instanceId}] exited with code ${code}`);
        if (stderr) {
          console.error(`[${instanceId}] stderr: ${stderr}`);
        }
      }

      // Parse JSON output
      const responses = parseOpenCodeOutput(stdout, instanceId);

      // Store session ID from first response if available
      if (isFirstMessage && responses.sessionId) {
        instance.sessionId = responses.sessionId;
      }

      resolve({ success: true, responses: responses.texts });
    });

    proc.on('error', (err) => {
      console.error(`[${instanceId}] failed to spawn:`, err);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Parse OpenCode's JSON output
 * OpenCode outputs JSON when using -f json flag
 */
function parseOpenCodeOutput(output, instanceId) {
  const result = { texts: [], sessionId: null };

  if (!output.trim()) {
    return result;
  }

  try {
    // Try parsing as a single JSON object first
    const json = JSON.parse(output);

    // Extract text content based on OpenCode's response structure
    if (json.response) {
      result.texts.push(json.response);
    } else if (json.content) {
      result.texts.push(extractTextContent(json.content));
    } else if (json.message) {
      result.texts.push(typeof json.message === 'string' ? json.message : JSON.stringify(json.message));
    } else if (typeof json === 'string') {
      result.texts.push(json);
    } else {
      // Fallback: stringify the whole response
      result.texts.push(JSON.stringify(json, null, 2));
    }

    // Extract session ID if present
    if (json.sessionId || json.session_id) {
      result.sessionId = json.sessionId || json.session_id;
    }
  } catch (e) {
    // If JSON parsing fails, try line-by-line (nd-JSON)
    // Also handle concatenated JSON objects (no newlines between them)
    const normalized = output.trim().replace(/\}\s*\{/g, '}\n{');
    const lines = normalized.split('\n');
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
        // If not JSON, treat as plain text
        if (line.trim() && !line.startsWith('[') && !line.includes('spinner')) {
          result.texts.push(line);
        }
      }
    }
  }

  // If we still have no text, use raw output
  if (result.texts.length === 0 && output.trim()) {
    result.texts.push(output.trim());
  }

  return result;
}

/**
 * Extract text from OpenCode event object
 */
function extractEventText(event) {
  // Handle various OpenCode event structures
  if (event.type === 'assistant' && event.message?.content) {
    return extractTextContent(event.message.content);
  }
  if (event.type === 'response' && event.text) {
    return event.text;
  }
  if (event.type === 'text' && event.part?.text) {
    return event.part.text;
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
 * Extract text content from content blocks (similar to Claude format)
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
  if (content.text) {
    return content.text;
  }
  return null;
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
  console.log(`[${instanceId}] stopped`);
  return { success: true };
}

/**
 * Post a message to Slack (handles long messages by chunking)
 */
async function postToSlack(channel, text) {
  const MAX_LENGTH = 3900; // Slack limit is 4000, leave some buffer

  try {
    // Split long messages
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }
      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
        breakPoint = remaining.lastIndexOf(' ', MAX_LENGTH);
      }
      if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
        breakPoint = MAX_LENGTH;
      }
      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    for (const chunk of chunks) {
      await app.client.chat.postMessage({
        channel,
        text: chunk,
        unfurl_links: false,
        unfurl_media: false
      });
    }
  } catch (err) {
    console.error('Failed to post to Slack:', err);
  }
}

/**
 * Find instance by Slack channel
 */
function getInstanceByChannel(channelId) {
  for (const [instanceId, instance] of instances) {
    if (instance.channel === channelId) {
      return { instanceId, instance };
    }
  }
  return null;
}

// Listen to messages in channels where an instance is running
app.message(async ({ message, say }) => {
  // Ignore bot messages and message edits
  if (message.subtype || message.bot_id) return;

  const found = getInstanceByChannel(message.channel);
  if (found) {
    // Send typing indicator by posting a temporary message
    const thinking = await app.client.chat.postMessage({
      channel: message.channel,
      text: '_Thinking..._'
    });

    const result = await sendToInstance(found.instanceId, message.text);

    // Delete the thinking message
    try {
      await app.client.chat.delete({
        channel: message.channel,
        ts: thinking.ts
      });
    } catch (e) {
      // Ignore if we can't delete
    }

    if (result.success && result.responses.length > 0) {
      for (const response of result.responses) {
        await postToSlack(message.channel, response);
      }
    } else if (!result.success) {
      await say(`_Error: ${result.error}_`);
    }
  }
});

// Slash command: /od-start <instanceId> <projectDir>
app.command('/od-start', async ({ command, ack, respond }) => {
  await ack();

  const parts = command.text.trim().split(/\s+/);
  if (parts.length < 2) {
    await respond('Usage: `/od-start <instance-name> <project-directory>`');
    return;
  }

  const [instanceId, ...pathParts] = parts;
  const projectDir = pathParts.join(' '); // Handle paths with spaces

  const result = startInstance(instanceId, projectDir, command.channel_id);

  if (result.success) {
    const modelInfo = OPENCODE_MODEL ? `\nModel: \`${OPENCODE_MODEL}\`` : '';
    await respond(`Started OpenCode instance *${instanceId}* in \`${projectDir}\`${modelInfo}\n\nMessages in this channel will be sent to OpenCode.`);
  } else {
    await respond(`Failed to start: ${result.error}`);
  }
});

// Slash command: /od-stop <instanceId>
app.command('/od-stop', async ({ command, ack, respond }) => {
  await ack();

  const instanceId = command.text.trim();
  if (!instanceId) {
    await respond('Usage: `/od-stop <instance-name>`');
    return;
  }

  const result = stopInstance(instanceId);

  if (result.success) {
    await respond(`Stopped OpenCode instance *${instanceId}*`);
  } else {
    await respond(`Failed to stop: ${result.error}`);
  }
});

// Slash command: /od-list
app.command('/od-list', async ({ ack, respond }) => {
  await ack();

  if (instances.size === 0) {
    await respond('No OpenCode instances running.');
    return;
  }

  const lines = [];
  for (const [instanceId, instance] of instances) {
    const uptime = Math.round((Date.now() - instance.startedAt.getTime()) / 1000 / 60);
    lines.push(`• *${instanceId}* — \`${instance.projectDir}\` (${instance.messageCount} messages, ${uptime}m uptime)`);
  }

  await respond(`*Running OpenCode instances:*\n${lines.join('\n')}`);
});

// Slash command: /od-send <instanceId> <message>
app.command('/od-send', async ({ command, ack, respond }) => {
  await ack();

  const match = command.text.match(/^(\S+)\s+(.+)$/s);
  if (!match) {
    await respond('Usage: `/od-send <instance-name> <message>`');
    return;
  }

  const [, instanceId, message] = match;

  await respond(`Sending to OpenCode instance *${instanceId}*...`);

  const result = await sendToInstance(instanceId, message);

  if (result.success && result.responses.length > 0) {
    const instance = instances.get(instanceId);
    if (instance) {
      for (const response of result.responses) {
        await postToSlack(instance.channel, response);
      }
    }
  } else if (!result.success) {
    await respond(`Failed: ${result.error}`);
  }
});

// Start the app
(async () => {
  await app.start();
  console.log('OpenCode Dispatch is running');
  console.log('Waiting for Slack commands...');
  if (OPENCODE_MODEL) {
    console.log(`Using model: ${OPENCODE_MODEL}`);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await app.stop();
  process.exit(0);
});
