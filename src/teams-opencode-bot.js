/**
 * Teams Bot with OpenCode Backend
 *
 * This bot uses OpenCode (supporting 75+ AI providers) instead of Claude CLI.
 * Use this when you want to use OpenAI, Google, local models, etc.
 */

const { registerFatalHandlers } = require('./process-handlers');
registerFatalHandlers();

require('dotenv').config();

const { 
  CloudAdapter, 
  ConfigurationBotFrameworkAuthentication,
  ActivityTypes, 
  CardFactory, 
  TurnContext 
} = require('botbuilder');
const restify = require('restify');
const { createInstanceManager, chunkText } = require('./opencode-core');

const server = restify.createServer();
server.use(restify.plugins.bodyParser());

const PORT = process.env.PORT || 3978;

const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID || '',
  MicrosoftAppType: process.env.MICROSOFT_APP_TENANT_ID ? 'SingleTenant' : 'MultiTenant',
});

const adapter = new CloudAdapter(botFrameworkAuth);

// Error handling
adapter.onTurnError = async (context, error) => {
  console.error(`[Bot Error] ${error}`);
  await context.sendActivity('Sorry, something went wrong. Please try again.');
};

// Create instance manager with optional model override
const instanceManager = createInstanceManager({
  model: process.env.OPENCODE_MODEL || null
});

// User session state: tracks which instance each user has selected.
// Key: aadObjectId (Teams user ID), Value: instanceId.
// NOTE: This Map is in-memory only. All selections will be lost if the bot process restarts.
// For production use, consider backing this with persistent storage (e.g., database or cache).
const userSelectedInstance = new Map();

// ============================================
// ADAPTIVE CARD TEMPLATES
// ============================================

function createInstanceStartedCard(instanceId, projectDir, sessionId, model) {
  const facts = [
    { title: 'Instance', value: instanceId },
    { title: 'Project', value: projectDir },
    { title: 'Session', value: sessionId.substring(0, 8) + '...' }
  ];
  
  if (model) {
    facts.push({ title: 'Model', value: model });
  }

  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '✅ OpenCode Instance Started',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Good'
      },
      {
        type: 'FactSet',
        facts
      },
      {
        type: 'TextBlock',
        text: 'Messages in this conversation will now be sent to OpenCode.',
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
        text: '🛑 OpenCode Instance Stopped',
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

function createInstanceListCard(instancesData, selectedInstanceId) {
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
          text: 'Use `oc-start <name> <project-path>` to start a new instance.',
          wrap: true
        }
      ]
    });
  }

  const items = instancesData.map((inst) => {
    const uptime = Math.round((Date.now() - inst.startedAt.getTime()) / 1000 / 60);
    const isSelected = inst.instanceId === selectedInstanceId;
    const nameDisplay = isSelected ? `**${inst.instanceId}** ✅ (selected)` : `**${inst.instanceId}**`;
    return {
      type: 'Container',
      items: [
        {
          type: 'TextBlock',
          text: nameDisplay,
          weight: 'Bolder'
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Project', value: inst.projectDir },
            { title: 'Messages', value: String(inst.messageCount) },
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
        text: '📋 Running OpenCode Instances',
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

function createInstanceSelectedCard(instanceId, projectDir) {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '🎯 Instance Selected',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Good'
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Instance', value: instanceId },
          { title: 'Project', value: projectDir }
        ]
      },
      {
        type: 'TextBlock',
        text: 'Your messages will now be sent to this instance. Use `oc-select <name>` to switch or `oc-clear` to deselect.',
        wrap: true,
        spacing: 'Medium'
      }
    ]
  });
}

function getUserId(context) {
  return context.activity.from?.aadObjectId || context.activity.from?.id;
}

// ============================================
// MESSAGE HANDLING
// ============================================

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
  const instances = instanceManager.listInstances();
  
  for (const inst of instances) {
    if (getConversationId(inst.channel) === convId) {
      return { instanceId: inst.instanceId, instance: inst };
    }
  }
  return null;
}

function parseCommand(text) {
  const cleanText = text.replace(/<at>.*?<\/at>/g, '').trim();

  // Support oc-*, opencode-*, and claude-* prefixes
  const commandMatch = cleanText.match(/^(oc-start|oc-stop|oc-list|oc-send|oc-select|oc-clear|opencode-start|opencode-stop|opencode-list|opencode-send|opencode-select|opencode-clear|claude-start|claude-stop|claude-list|claude-send|claude-select|claude-clear)\s*(.*)?$/i);
  if (commandMatch) {
    let command = commandMatch[1].toLowerCase();
    // Normalize to oc-* format
    if (command.startsWith('opencode-')) {
      command = command.replace('opencode-', 'oc-');
    } else if (command.startsWith('claude-')) {
      command = command.replace('claude-', 'oc-');
    }
    return {
      command,
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
        case 'oc-start': {
          const parts = args.split(/\s+/);
          if (parts.length < 2) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `oc-start <instance-name> <project-directory>`')]
            });
            return;
          }

          const [instanceId, ...pathParts] = parts;
          const projectDir = pathParts.join(' ');
          const conversationRef = TurnContext.getConversationReference(context.activity);

          const result = instanceManager.startInstance(instanceId, projectDir, conversationRef);

          if (result.success) {
            await context.sendActivity({
              attachments: [createInstanceStartedCard(instanceId, projectDir, result.sessionId, process.env.OPENCODE_MODEL)]
            });
          } else {
            await context.sendActivity({
              attachments: [createErrorCard('Failed to Start', result.error)]
            });
          }
          break;
        }

        case 'oc-stop': {
          const instanceId = args;
          if (!instanceId) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `oc-stop <instance-name>`')]
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

        case 'oc-list': {
          const instancesData = instanceManager.listInstances();
          const userId = getUserId(context);
          const selectedInstanceId = userSelectedInstance.get(userId);

          await context.sendActivity({
            attachments: [createInstanceListCard(instancesData, selectedInstanceId)]
          });
          break;
        }

        case 'oc-send': {
          const match = args.match(/^(\S+)\s+(.+)$/s);
          if (!match) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `oc-send <instance-name> <message>`')]
            });
            return;
          }

          const [, instanceId, message] = match;

          await context.sendActivity({ type: ActivityTypes.Typing });

          const onMessage = async (text) => {
            await postToTeams(context, `**[${instanceId}]**\n\n${text}`);
          };

          const result = await instanceManager.sendToInstance(instanceId, message, { onMessage });

          if (!result.success) {
            await context.sendActivity({
              attachments: [createErrorCard('Failed to Send', result.error)]
            });
          } else if (!result.streamed && result.responses.length > 0) {
            for (const response of result.responses) {
              await postToTeams(context, `**[${instanceId}]**\n\n${response}`);
            }
          }
          break;
        }

        case 'oc-select': {
          const instanceId = args;
          if (!instanceId) {
            await context.sendActivity({
              attachments: [createErrorCard('Invalid Usage', 'Usage: `oc-select <instance-name>`')]
            });
            return;
          }

          const instance = instanceManager.getInstance(instanceId);
          if (!instance) {
            await context.sendActivity({
              attachments: [createErrorCard('Instance Not Found', `No instance named "${instanceId}" is running. Use \`oc-list\` to see available instances.`)]
            });
            return;
          }

          const userId = getUserId(context);
          userSelectedInstance.set(userId, instanceId);

          await context.sendActivity({
            attachments: [createInstanceSelectedCard(instanceId, instance.projectDir)]
          });
          break;
        }

        case 'oc-clear': {
          const userId = getUserId(context);
          const hadSelection = userSelectedInstance.has(userId);
          userSelectedInstance.delete(userId);

          if (hadSelection) {
            await context.sendActivity('✅ Instance selection cleared. Your messages will no longer be routed automatically.');
          } else {
            await context.sendActivity('No instance was selected.');
          }
          break;
        }
      }
      return;
    }

    // No command - check user's selected instance first, then conversation binding
    const userId = getUserId(context);
    const selectedInstanceId = userSelectedInstance.get(userId);
    
    let targetInstanceId = null;
    
    if (selectedInstanceId) {
      if (instanceManager.getInstance(selectedInstanceId)) {
        targetInstanceId = selectedInstanceId;
      } else {
        userSelectedInstance.delete(userId);
        await context.sendActivity(`⚠️ Your selected instance "${selectedInstanceId}" is no longer running. Selection cleared.`);
      }
    }
    
    if (!targetInstanceId) {
      const conversationRef = TurnContext.getConversationReference(context.activity);
      const found = getInstanceByConversation(conversationRef);
      if (found) {
        targetInstanceId = found.instanceId;
      }
    }

    if (targetInstanceId && messageText) {
      console.log(`[DEBUG] Routing to instance: ${targetInstanceId}`);

      await context.sendActivity({ type: ActivityTypes.Typing });

      const onMessage = async (text) => {
        await postToTeams(context, `**[${targetInstanceId}]**\n\n${text}`);
      };

      const result = await instanceManager.sendToInstance(targetInstanceId, messageText, { onMessage });

      if (!result.success) {
        await context.sendActivity({
          attachments: [createErrorCard('Error', result.error)]
        });
      } else if (!result.streamed && result.responses.length > 0) {
        for (const response of result.responses) {
          await postToTeams(context, `**[${targetInstanceId}]**\n\n${response}`);
        }
      }
    } else if (!targetInstanceId && messageText) {
      await context.sendActivity(
        'No OpenCode instance selected.\n\n' +
        '**Commands:**\n' +
        '- `oc-start <name> <project-path>` - Start a new instance\n' +
        '- `oc-select <name>` - Select an instance to chat with\n' +
        '- `oc-clear` - Clear your instance selection\n' +
        '- `oc-list` - List running instances\n' +
        '- `oc-send <name> <message>` - Send to a specific instance'
      );
    }
  } else if (context.activity.type === ActivityTypes.ConversationUpdate) {
    // Welcome new members
    if (context.activity.membersAdded) {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          const modelInfo = process.env.OPENCODE_MODEL ? `\n\n**Model:** ${process.env.OPENCODE_MODEL}` : '';
          await context.sendActivity(
            '👋 Hello! I\'m OpenCode Dispatch.\n\n' +
            'I help you control OpenCode instances (75+ AI providers) from Teams.' + modelInfo + '\n\n' +
            '**Commands:**\n' +
            '- `oc-start <name> <project-path>` - Start a new instance\n' +
            '- `oc-select <name>` - Select an instance to chat with\n' +
            '- `oc-clear` - Clear your instance selection\n' +
            '- `oc-stop <name>` - Stop an instance\n' +
            '- `oc-list` - List running instances\n' +
            '- `oc-send <name> <message>` - Send to a specific instance'
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
    instances: instanceManager.listInstances().length,
    backend: 'opencode',
    model: process.env.OPENCODE_MODEL || 'default'
  });
  next();
});

// Start server
server.listen(PORT, () => {
  console.log(`OpenCode Dispatch (Teams) is running on port ${PORT}`);
  console.log(`Messaging endpoint: http://localhost:${PORT}/api/messages`);
  console.log(`Backend: OpenCode`);
  if (process.env.OPENCODE_MODEL) {
    console.log(`Model: ${process.env.OPENCODE_MODEL}`);
  }
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
