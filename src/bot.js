const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { App } = require('@slack/bolt');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');

// Initialize Slack app with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Track instances: instanceId → { sessionId, channel, projectDir, messageCount }
const instances = new Map();

/**
 * Start a new Claude Code instance (creates session, doesn't spawn persistent process)
 */
function startInstance(instanceId, projectDir, slackChannel) {
  if (instances.has(instanceId)) {
    return { success: false, error: `Instance "${instanceId}" already running` };
  }

  const sessionId = randomUUID();

  instances.set(instanceId, {
    sessionId,
    channel: slackChannel,
    projectDir,
    messageCount: 0,
    startedAt: new Date()
  });

  console.log(`[${instanceId}] created session ${sessionId} in ${projectDir}`);
  return { success: true, sessionId };
}

/**
 * Send a message to a Claude instance (spawns process, waits for response)
 */
async function sendToInstance(instanceId, message) {
  const instance = instances.get(instanceId);
  if (!instance) {
    return { success: false, error: `Instance "${instanceId}" not found` };
  }

  const isFirstMessage = instance.messageCount === 0;
  instance.messageCount++;

  // Build command args
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
    const proc = spawn('claude', args, {
      cwd: instance.projectDir,
      shell: true,
      env: { ...process.env }
    });

    const rl = readline.createInterface({ input: proc.stdout });
    const responses = [];

    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);

        // Collect assistant text messages
        if (event.type === 'assistant' && event.message?.content) {
          const text = extractText(event.message.content);
          if (text) {
            responses.push(text);
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      // Filter out the stdin close error which is expected
      if (!msg.includes('Error') || msg.includes('write')) {
        return;
      }
      console.error(`[${instanceId}] stderr: ${msg}`);
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[${instanceId}] exited with code ${code}`);
      }
      resolve({ success: true, responses });
    });

    proc.on('error', (err) => {
      console.error(`[${instanceId}] failed to spawn:`, err);
      resolve({ success: false, error: err.message });
    });

    // Send the message as JSON
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
 * Extract text content from Claude's message content blocks
 */
function extractText(content) {
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }
  return typeof content === 'string' ? content : null;
}

/**
 * Stop a Claude instance
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
  console.log(`[DEBUG] Received message in channel ${message.channel}: ${message.text?.substring(0, 50)}`);

  // Ignore bot messages and message edits
  if (message.subtype || message.bot_id) {
    console.log(`[DEBUG] Ignoring message (subtype: ${message.subtype}, bot_id: ${message.bot_id})`);
    return;
  }

  const found = getInstanceByChannel(message.channel);
  console.log(`[DEBUG] Found instance: ${found ? found.instanceId : 'none'}`);
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
    await respond(`Started instance *${instanceId}* in \`${projectDir}\`\nSession: \`${result.sessionId}\`\n\nMessages in this channel will be sent to Claude.`);
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
    await respond(`Stopped instance *${instanceId}*`);
  } else {
    await respond(`Failed to stop: ${result.error}`);
  }
});

// Slash command: /od-list
app.command('/od-list', async ({ ack, respond }) => {
  await ack();

  if (instances.size === 0) {
    await respond('No instances running.');
    return;
  }

  const lines = [];
  for (const [instanceId, instance] of instances) {
    const uptime = Math.round((Date.now() - instance.startedAt.getTime()) / 1000 / 60);
    lines.push(`• *${instanceId}* — \`${instance.projectDir}\` (${instance.messageCount} messages, ${uptime}m uptime)`);
  }

  await respond(`*Running instances:*\n${lines.join('\n')}`);
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

  await respond(`Sending to *${instanceId}*...`);

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

// Health check server for Fly.io
const http = require('http');
const PORT = process.env.PORT || 3978;

const healthServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      backend: 'claude',
      instances: instances.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start the app
(async () => {
  healthServer.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
  });
  await app.start();
  console.log('Claude Dispatch is running');
  console.log('Waiting for Slack commands...');
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  healthServer.close();
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  healthServer.close();
  await app.stop();
  process.exit(0);
});
