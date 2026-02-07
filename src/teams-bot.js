/**
 * Teams Bot with Claude Code Backend
 *
 * This bot connects Microsoft Teams to Claude Code CLI.
 * For OpenCode support (75+ AI providers), use teams-opencode-bot.js instead.
 */

const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { BotFrameworkAdapter, ActivityTypes, CardFactory, TurnContext } = require('botbuilder');
const restify = require('restify');
const { createInstanceManager, chunkText } = require('./claude-core');

// Create HTTP server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

const PORT = process.env.PORT || 3978;

// Create Bot Framework adapter
const adapter = new BotFrameworkAdapter({
  appId: process.env.MICROSOFT_APP_ID,
  appPassword: process.env.MICROSOFT_APP_PASSWORD,
});

// Error handling
adapter.onTurnError = async (context, error) => {
  console.error(`[Bot Error] ${error}`);
  await context.sendActivity('Sorry, something went wrong. Please try again.');
};

// Create instance manager
const instanceManager = createInstanceManager();

// ============================================
// ADAPTIVE CARD TEMPLATES
// ============================================

function createInstanceStartedCard(instanceId, projectDir, sessionId) {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '✅ Claude Instance Started',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Good'
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Instance', value: instanceId },
          { title: 'Project', value: projectDir },
          { title: 'Session', value: sessionId.substring(0, 8) + '...' }
        ]
      },
      {
        type: 'TextBlock',
        text: 'Messages in this conversation will now be sent to Claude.',
        wrap: true,
        spacing: 'Medium'
      }
    ]
  });
}

function createInstanceStoppedCard(instanceId) {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '🛑 Claude Instance Stopped',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Attention'
      },
      {
        type: 'TextBlock',
        text: `Instance "${instanceId}" has been stopped.`,
        wrap: true
      }
    ]
  });
}

function createInstanceListCard(instancesData) {
  if (instancesData.length === 0) {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: '📋 No Running Instances',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'TextBlock',
          text: 'Use `claude-start <name> <project-path>` to start a new instance.',
          wrap: true
        }
      ]
    });
  }

  const items = instancesData.map(({ instanceId, instance }) => {
    const uptime = Math.round((Date.now() - instance.startedAt.getTime()) / 1000 / 60);
    return {
      type: 'Container',
      items: [
        {
          type: 'TextBlock',
          text: `**${instanceId}**`,
          weight: 'Bolder'
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Project', value: instance.projectDir },
            { title: 'Messages', value: String(instance.messageCount) },
            { title: 'Uptime', value: `${uptime} minutes` }
          ]
        }
      ],
      separator: true,
      spacing: 'Medium'
    };
  });

  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '📋 Running Claude Instances',
        weight: 'Bolder',
        size: 'Medium'
      },
      ...items
    ]
  });
}

function createErrorCard(title, message) {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: `❌ ${title}`,
        weight: 'Bolder',
        size: 'Medium',
        color: 'Attention'
      },
      {
        type: 'TextBlock',
        text: message,
        wrap: true
      }
    ]
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get conversation reference ID for lookups
 */
function getConversationId(conversationRef) {
  return conversationRef.conversation?.id || conversationRef.conversation;
}

/**
 * Find instance by conversation reference
 */
function getInstanceByConversation(conversationRef) {
  const convId = getConversationId(conversationRef);
  const allInstances = instanceManager.listInstances();
  
  for (const inst of allInstances) {
    if (getConversationId(inst.channel) === convId) {
      return { instanceId: inst.instanceId, instance: inst };
    }
  }
  return null;
}

/**
 * Post response to Teams (handles long messages by chunking)
 */
async function postToTeams(context, text) {
  const MAX_LENGTH = 25000; // Teams limit is ~28KB, leave buffer
  const chunks = chunkText(text, MAX_LENGTH);

  for (const chunk of chunks) {
    await context.sendActivity(chunk);
  }
}

/**
 * Parse command from message text
 */
function parseCommand(text) {
  // Remove bot mention (Teams includes @mention in message)
  const cleanText = text.replace(/<at>.*?<\/at>/g, '').trim();

  // Check for commands
  const commandMatch = cleanText.match(/^(claude-start|claude-stop|claude-list|claude-send)\s*(.*)?$/i);
  if (commandMatch) {
    return {
      command: commandMatch[1].toLowerCase(),
      args: (commandMatch[2] || '').trim()
    };
  }

  return { command: null, text: cleanText };
}

/**
 * Main bot logic
 */
async function botLogic(context) {
  if (context.activity.type === ActivityTypes.Message) {
    const text = context.activity.text || '';
    const { command, args, text: messageText } = parseCommand(text);

    console.log(`[DEBUG] Received message: ${text.substring(0, 50)}`);
    console.log(`[DEBUG] Parsed command: ${command}, args: ${args}`);

    // Handle commands
    if (command) {
      switch (command) {
        case 'claude-start': {
          const parts = args.split(/\s+/);
          if (parts.length < 2) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `claude-start <instance-name> <project-directory>`')]
            });
            return;
          }

          const [instanceId, ...pathParts] = parts;
          const projectDir = pathParts.join(' ');
          const conversationRef = TurnContext.getConversationReference(context.activity);

          const result = instanceManager.startInstance(instanceId, projectDir, conversationRef);

          if (result.success) {
            await context.sendActivity({
              attachments: [createInstanceStartedCard(instanceId, projectDir, result.sessionId)]
            });
          } else {
            await context.sendActivity({
              attachments: [createErrorCard('Failed to Start', result.error)]
            });
          }
          break;
        }

        case 'claude-stop': {
          const instanceId = args;
          if (!instanceId) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `claude-stop <instance-name>`')]
            });
            return;
          }

          const result = instanceManager.stopInstance(instanceId);

          if (result.success) {
            await context.sendActivity({
              attachments: [createInstanceStoppedCard(instanceId)]
            });
          } else {
            await context.sendActivity({
              attachments: [createErrorCard('Failed to Stop', result.error)]
            });
          }
          break;
        }

        case 'claude-list': {
          const instancesData = instanceManager.listInstances().map((inst) => ({
            instanceId: inst.instanceId,
            instance: inst
          }));

          await context.sendActivity({
            attachments: [createInstanceListCard(instancesData)]
          });
          break;
        }

        case 'claude-send': {
          const match = args.match(/^(\S+)\s+(.+)$/s);
          if (!match) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `claude-send <instance-name> <message>`')]
            });
            return;
          }

          const [, instanceId, message] = match;

          await context.sendActivity({ type: ActivityTypes.Typing });

          const onMessage = async (text) => {
            await postToTeams(context, text);
          };

          const result = await instanceManager.sendToInstance(instanceId, message, { onMessage });

          if (!result.success) {
            await context.sendActivity({
              attachments: [createErrorCard('Failed to Send', result.error)]
            });
          } else if (!result.streamed && result.responses.length > 0) {
            for (const response of result.responses) {
              await postToTeams(context, response);
            }
          }
          break;
        }
      }
      return;
    }

    // No command - check if this conversation has an active instance
    const conversationRef = TurnContext.getConversationReference(context.activity);
    const found = getInstanceByConversation(conversationRef);

    if (found && messageText) {
      console.log(`[DEBUG] Found instance: ${found.instanceId}`);

      await context.sendActivity({ type: ActivityTypes.Typing });

      const onMessage = async (text) => {
        await postToTeams(context, text);
      };

      const result = await instanceManager.sendToInstance(found.instanceId, messageText, { onMessage });

      if (!result.success) {
        await context.sendActivity({
          attachments: [createErrorCard('Error', result.error)]
        });
      } else if (!result.streamed && result.responses.length > 0) {
        for (const response of result.responses) {
          await postToTeams(context, response);
        }
      }
    } else if (!found && messageText) {
      // No active instance, provide help
      await context.sendActivity(
        'No Claude instance is running in this conversation.\n\n' +
        '**Commands:**\n' +
        '- `claude-start <name> <project-path>` - Start a new instance\n' +
        '- `claude-stop <name>` - Stop an instance\n' +
        '- `claude-list` - List running instances\n' +
        '- `claude-send <name> <message>` - Send to a specific instance'
      );
    }
  } else if (context.activity.type === ActivityTypes.ConversationUpdate) {
    // Welcome new members
    if (context.activity.membersAdded) {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            '👋 Hello! I\'m Claude Dispatch.\n\n' +
            'I help you control Claude Code instances from Teams.\n\n' +
            '**Commands:**\n' +
            '- `claude-start <name> <project-path>` - Start a new instance\n' +
            '- `claude-stop <name>` - Stop an instance\n' +
            '- `claude-list` - List running instances\n' +
            '- `claude-send <name> <message>` - Send to a specific instance'
          );
        }
      }
    }
  }
}

// ============================================
// SERVER SETUP
// ============================================

// Listen for incoming requests
server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, botLogic);
});

// Health check endpoint
server.get('/health', (req, res, next) => {
  res.send(200, { 
    status: 'healthy', 
    backend: 'claude',
    instances: instanceManager.listInstances().length 
  });
  next();
});

// Start server
server.listen(PORT, () => {
  console.log(`Claude Dispatch (Teams) is running on port ${PORT}`);
  console.log(`Backend: Claude Code CLI`);
  console.log(`Messaging endpoint: http://localhost:${PORT}/api/messages`);
  console.log('');
  console.log('For local development with ngrok:');
  console.log(`  ngrok http ${PORT}`);
  console.log('  Then update your Teams Developer Portal bot messaging endpoint');
});

// Graceful shutdown
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nShutting down... (${signal})`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
