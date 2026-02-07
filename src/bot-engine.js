/**
 * Bot Engine
 *
 * Platform-agnostic bot logic that works with any ChatProvider and AI backend.
 * Handles command parsing, instance routing, and response formatting.
 */

/**
 * @typedef {Object} BotEngineOptions
 * @property {import('./providers/chat-provider').ChatProvider} chatProvider - Chat platform provider
 * @property {Object} aiBackend - AI instance manager (from claude-core or opencode-core)
 * @property {string} [commandPrefix='od'] - Command prefix for text commands
 * @property {string} [aiName='AI'] - Display name for the AI (e.g., 'Claude', 'OpenCode')
 * @property {boolean} [showThinking=true] - Show "Thinking..." indicator
 * @property {boolean} [streamResponses=true] - Use streaming if available
 */

/**
 * Create a bot engine instance
 * @param {BotEngineOptions} options
 * @returns {Object} Bot engine with start/stop methods
 */
function createBotEngine(options) {
  const {
    chatProvider,
    aiBackend,
    commandPrefix = 'od',
    aiName = 'AI',
    showThinking = true,
    streamResponses = true
  } = options;

  if (!chatProvider) {
    throw new Error('chatProvider is required');
  }
  if (!aiBackend) {
    throw new Error('aiBackend is required');
  }

  // ============================================
  // MESSAGE BATCHER (rate-limit protection)
  // ============================================

  /**
   * Create a message batcher that buffers output and flushes as
   * code-block messages. Prevents hitting chat API rate limits.
   * @param {string} channelId
   * @returns {Object} { push(text), flush(), destroy() }
   */
  function createMessageBatcher(channelId) {
    const buffer = [];
    let flushTimer = null;
    let destroyed = false;
    let lastSendTime = 0;
    const MIN_SEND_INTERVAL = 200; // ms between chat API calls
    const FLUSH_DELAY = 500; // buffer for 500ms
    const MAX_LINES = 5; // or 5 lines, whichever first

    function scheduleFlush() {
      if (flushTimer || destroyed) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush().catch(err => console.error('[bot-engine] Flush error:', err));
      }, FLUSH_DELAY);
    }

    async function flush() {
      if (buffer.length === 0 || destroyed) return;

      const text = buffer.splice(0).join('\n');
      if (!text.trim()) return;

      // Rate limit: wait if we sent too recently
      const elapsed = Date.now() - lastSendTime;
      if (elapsed < MIN_SEND_INTERVAL) {
        await new Promise(r => setTimeout(r, MIN_SEND_INTERVAL - elapsed));
      }

      try {
        await chatProvider.sendLongMessage(channelId, '```\n' + text + '\n```');
        lastSendTime = Date.now();
      } catch (e) {
        console.error('[BotEngine] Batcher send error:', e.message);
      }
    }

    return {
      push(text) {
        if (destroyed) return;
        buffer.push(text);
        if (buffer.length >= MAX_LINES) {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          flush().catch(err => console.error('[bot-engine] Flush error:', err));
        } else {
          scheduleFlush();
        }
      },
      async flush() {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flush();
      },
      destroy() {
        destroyed = true;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      }
    };
  }

  // ============================================
  // COMMAND HANDLERS
  // ============================================

  /**
   * Handle the 'start' command
   */
  async function handleStart(ctx, args) {
    const parts = args.trim().split(/\s+/);

    if (parts.length < 2) {
      await ctx.reply(
        `Usage: \`${commandPrefix}-start <instance-name> <project-directory>\``
      );
      return;
    }

    const [instanceId, ...pathParts] = parts;
    const projectDir = pathParts.join(' ');

    const result = await aiBackend.startInstance(instanceId, projectDir, ctx.channelId);

    if (result.success) {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: `${aiName} Instance Started`,
          color: '#00ff00',
          fields: [
            { name: 'Instance', value: instanceId, inline: true },
            { name: 'Project', value: projectDir, inline: true },
            { name: 'Session', value: result.sessionId.substring(0, 8) + '...', inline: true }
          ],
          footer: `Messages in this channel will be sent to ${aiName}.`
        });
      } else {
        await ctx.reply(
          `Started instance **${instanceId}** in \`${projectDir}\`\n` +
          `Session: \`${result.sessionId}\`\n\n` +
          `Messages in this channel will be sent to ${aiName}.`
        );
      }
    } else {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'Failed to Start',
          color: '#ff0000',
          description: result.error
        });
      } else {
        await ctx.reply(`Failed to start: ${result.error}`);
      }
    }
  }

  /**
   * Handle the 'stop' command
   */
  async function handleStop(ctx, args) {
    const instanceId = args.trim();

    if (!instanceId) {
      await ctx.reply(`Usage: \`${commandPrefix}-stop <instance-name>\``);
      return;
    }

    const result = aiBackend.stopInstance(instanceId);

    if (result.success) {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: `${aiName} Instance Stopped`,
          color: '#ff9900',
          description: `Instance "${instanceId}" has been stopped.`
        });
      } else {
        await ctx.reply(`Stopped instance **${instanceId}**`);
      }
    } else {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'Failed to Stop',
          color: '#ff0000',
          description: result.error
        });
      } else {
        await ctx.reply(`Failed to stop: ${result.error}`);
      }
    }
  }

  /**
   * Handle the 'list' command
   */
  async function handleList(ctx) {
    const instances = aiBackend.listInstances();

    if (instances.length === 0) {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'No Running Instances',
          description: `Use \`${commandPrefix}-start <name> <project-path>\` to start a new instance.`
        });
      } else {
        await ctx.reply('No instances running.');
      }
      return;
    }

    if (chatProvider.supportsCards) {
      const fields = instances.map((inst) => {
        const uptime = Math.round((Date.now() - inst.startedAt.getTime()) / 1000 / 60);
        return {
          name: inst.instanceId,
          value: `${inst.projectDir}\n${inst.messageCount} messages | ${uptime}m uptime`,
          inline: false
        };
      });

      await chatProvider.sendCard(ctx.channelId, {
        title: `Running ${aiName} Instances`,
        color: '#0099ff',
        fields
      });
    } else {
      const lines = instances.map((inst) => {
        const uptime = Math.round((Date.now() - inst.startedAt.getTime()) / 1000 / 60);
        return `- **${inst.instanceId}** - \`${inst.projectDir}\` (${inst.messageCount} messages, ${uptime}m uptime)`;
      });

      await ctx.reply(`**Running instances:**\n${lines.join('\n')}`);
    }
  }

  /**
   * Handle the 'send' command
   */
  async function handleSend(ctx, args) {
    const match = args.match(/^(\S+)\s+(.+)$/s);

    if (!match) {
      await ctx.reply(
        `Usage: \`${commandPrefix}-send <instance-name> <message>\``
      );
      return;
    }

    const [, instanceId, message] = match;

    await sendMessageToInstance(ctx, instanceId, message);
  }

  /**
   * Handle the 'run' command (one-shot Sprite execution)
   * Usage: /od-run [--image <image>] [--repo <repo>] [--branch <branch>] <task>
   */
  async function handleRun(ctx, args) {
    // Check if backend supports run (has jobs - sprite-core)
    if (!aiBackend.jobs) {
      await ctx.reply(
        `The \`${commandPrefix}-run\` command requires Sprite backend.\n` +
        `Current backend doesn't support one-shot job execution.`
      );
      return;
    }

    // Parse options and task from args
    const parsed = parseRunArgs(args);

    if (!parsed.task) {
      await ctx.reply(
        `Usage: \`${commandPrefix}-run [--image <image>] [--repo <repo>] [--branch <branch>] <task>\`\n\n` +
        `**Examples:**\n` +
        `\`${commandPrefix}-run --repo github.com/user/project "run the tests"\`\n` +
        `\`${commandPrefix}-run --image my-agent:v1 --repo github.com/user/project "lint the code"\``
      );
      return;
    }

    // Create a temporary instance for this job
    const instanceId = `run-${Date.now()}`;
    const projectDir = parsed.repo || '';

    const startResult = await aiBackend.startInstance(instanceId, projectDir, ctx.channelId);
    if (!startResult.success) {
      await ctx.reply(`Failed to start job: ${startResult.error}`);
      return;
    }

    // Show initial message
    if (chatProvider.supportsCards) {
      await chatProvider.sendCard(ctx.channelId, {
        title: 'Job Started',
        color: '#0099ff',
        fields: [
          { name: 'Task', value: parsed.task, inline: false },
          parsed.repo && { name: 'Repo', value: parsed.repo, inline: true },
          parsed.branch && { name: 'Branch', value: parsed.branch, inline: true },
          parsed.image && { name: 'Image', value: parsed.image, inline: true }
        ].filter(Boolean),
        footer: 'Streaming logs as they arrive...'
      });
    } else {
      let msg = `**Job Started**\nTask: ${parsed.task}`;
      if (parsed.repo) msg += `\nRepo: ${parsed.repo}`;
      if (parsed.branch) msg += `\nBranch: ${parsed.branch}`;
      if (parsed.image) msg += `\nImage: ${parsed.image}`;
      await ctx.reply(msg);
    }

    // Show typing indicator
    await chatProvider.sendTypingIndicator(ctx.channelId);

    // Use message batcher for rate-limit protection
    const batcher = createMessageBatcher(ctx.channelId);
    const onMessage = async (text) => {
      batcher.push(text);
    };

    // Execute the job
    const result = await aiBackend.sendToInstance(instanceId, parsed.task, {
      onMessage,
      repo: parsed.repo,
      branch: parsed.branch,
      image: parsed.image
    });

    // Flush remaining output and clean up
    await batcher.flush();
    batcher.destroy();
    aiBackend.stopInstance(instanceId);

    // Send final status
    if (result.success) {
      if (chatProvider.supportsCards) {
        const fields = [
          { name: 'Status', value: 'Completed', inline: true },
          { name: 'Job ID', value: result.jobId || 'N/A', inline: true }
        ];

        if (result.artifacts && result.artifacts.length > 0) {
          fields.push({
            name: 'Artifacts',
            value: result.artifacts.map(a => `[${a.name}](${a.url})`).join('\n'),
            inline: false
          });
        }

        await chatProvider.sendCard(ctx.channelId, {
          title: 'Job Completed',
          color: '#00ff00',
          fields
        });
      } else {
        let msg = `**Job Completed** (${result.jobId || 'N/A'})`;
        if (result.artifacts && result.artifacts.length > 0) {
          msg += `\n\n**Artifacts:**\n${result.artifacts.map(a => `- ${a.name}: ${a.url}`).join('\n')}`;
        }
        await ctx.reply(msg);
      }
    } else {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'Job Failed',
          color: '#ff0000',
          description: result.error,
          fields: [
            { name: 'Job ID', value: result.jobId || 'N/A', inline: true }
          ]
        });
      } else {
        await ctx.reply(`**Job Failed** (${result.jobId || 'N/A'})\nError: ${result.error}`);
      }
    }
  }

  /**
   * Parse /od-run arguments
   * @param {string} args - Raw argument string
   * @returns {Object} Parsed options { image, repo, branch, task }
   */
  function parseRunArgs(args) {
    const result = { image: null, repo: null, branch: null, task: null };
    let remaining = args.trim();

    // Extract --option value pairs
    const optionRegex = /--(\w+)\s+(\S+)/g;
    let match;

    while ((match = optionRegex.exec(remaining)) !== null) {
      const [fullMatch, option, value] = match;
      switch (option.toLowerCase()) {
        case 'image':
          result.image = value;
          break;
        case 'repo':
          result.repo = value;
          break;
        case 'branch':
          result.branch = value;
          break;
      }
    }

    // Remove all --option value pairs to get the task
    remaining = remaining.replace(/--\w+\s+\S+/g, '').trim();

    // Task can be quoted or unquoted
    if (remaining.startsWith('"') && remaining.endsWith('"')) {
      result.task = remaining.slice(1, -1);
    } else if (remaining.startsWith("'") && remaining.endsWith("'")) {
      result.task = remaining.slice(1, -1);
    } else {
      result.task = remaining;
    }

    return result;
  }

  /**
   * Handle the 'jobs' command (list Sprite jobs)
   */
  async function handleJobs(ctx) {
    if (!aiBackend.listJobs) {
      await ctx.reply(`The \`${commandPrefix}-jobs\` command requires Sprite backend.`);
      return;
    }

    const jobs = aiBackend.listJobs();

    if (jobs.length === 0) {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'No Jobs',
          description: `Use \`${commandPrefix}-run\` to start a job.`
        });
      } else {
        await ctx.reply('No jobs found.');
      }
      return;
    }

    if (chatProvider.supportsCards) {
      const fields = jobs.slice(-10).map((job) => ({
        name: `${job.jobId.substring(0, 8)}... (${job.status})`,
        value: `${job.repo || 'N/A'}\n${job.artifactCount} artifacts`,
        inline: false
      }));

      await chatProvider.sendCard(ctx.channelId, {
        title: 'Recent Jobs',
        color: '#0099ff',
        fields
      });
    } else {
      const lines = jobs.slice(-10).map((job) =>
        `- **${job.jobId.substring(0, 8)}...** [${job.status}] - ${job.repo || 'N/A'}`
      );
      await ctx.reply(`**Recent Jobs:**\n${lines.join('\n')}`);
    }
  }

  /**
   * Send a message to an AI instance and handle the response
   */
  async function sendMessageToInstance(ctx, instanceId, message) {
    const instance = aiBackend.getInstance(instanceId);

    if (!instance) {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'Instance Not Found',
          color: '#ff0000',
          description: `Instance "${instanceId}" is not running.`
        });
      } else {
        await ctx.reply(`Instance "${instanceId}" not found.`);
      }
      return;
    }

    // Show typing indicator
    await chatProvider.sendTypingIndicator(ctx.channelId);

    // Optional "Thinking..." message
    let thinkingMessageId = null;
    let thinkingDeleted = false;
    if (showThinking) {
      try {
        const thinkingResult = await chatProvider.sendMessage(
          ctx.channelId,
          '_Thinking..._'
        );
        thinkingMessageId = thinkingResult.messageId;
      } catch (e) {
        // Ignore if we can't send thinking message
      }
    }

    // Helper to delete thinking message (only once)
    const deleteThinkingMessage = async () => {
      if (thinkingMessageId && !thinkingDeleted) {
        thinkingDeleted = true;
        try {
          await chatProvider.deleteMessage(ctx.channelId, thinkingMessageId);
        } catch (e) {
          // Ignore if we can't delete
        }
      }
    };

    // Track what we've streamed to avoid duplicates
    const streamedTexts = new Set();
    let didStream = false;

    // Prepare streaming callback - sends messages to chat in real-time
    const onMessage = streamResponses
      ? async (text) => {
          // Delete thinking message on first real response
          await deleteThinkingMessage();

          // Avoid sending duplicates
          if (streamedTexts.has(text)) {
            return;
          }
          streamedTexts.add(text);
          didStream = true;

          // Send to chat immediately
          try {
            await chatProvider.sendLongMessage(ctx.channelId, text);
          } catch (e) {
            console.error('[BotEngine] Failed to stream message:', e);
          }
        }
      : null;

    // Send to AI backend
    const result = await aiBackend.sendToInstance(instanceId, message, {
      onMessage
    });

    // Delete thinking message if we haven't already
    await deleteThinkingMessage();

    // Send response (only if we didn't stream, or streaming failed)
    if (result.success) {
      if (!didStream && result.responses && result.responses.length > 0) {
        for (const response of result.responses) {
          await chatProvider.sendLongMessage(ctx.channelId, response);
        }
      }
    } else {
      if (chatProvider.supportsCards) {
        await chatProvider.sendCard(ctx.channelId, {
          title: 'Error',
          color: '#ff0000',
          description: result.error
        });
      } else {
        await ctx.reply(`_Error: ${result.error}_`);
      }
    }
  }

  // ============================================
  // EVENT WIRING
  // ============================================

  /**
   * Handle incoming commands
   */
  chatProvider.onCommand(async (ctx, command, args) => {
    console.log(`[BotEngine] Command: ${command}, Args: ${args}`);

    switch (command.toLowerCase()) {
      case 'start':
        await handleStart(ctx, args);
        break;
      case 'stop':
        await handleStop(ctx, args);
        break;
      case 'list':
        await handleList(ctx);
        break;
      case 'send':
        await handleSend(ctx, args);
        break;
      case 'run':
        await handleRun(ctx, args);
        break;
      case 'jobs':
        await handleJobs(ctx);
        break;
      default:
        await ctx.reply(
          `Unknown command: ${command}\n\n` +
          `**Available commands:**\n` +
          `- \`${commandPrefix}-start <name> <path>\` - Start an instance\n` +
          `- \`${commandPrefix}-stop <name>\` - Stop an instance\n` +
          `- \`${commandPrefix}-list\` - List instances\n` +
          `- \`${commandPrefix}-send <name> <message>\` - Send to instance\n` +
          `- \`${commandPrefix}-run [options] <task>\` - Run one-shot job in Sprite\n` +
          `- \`${commandPrefix}-jobs\` - List recent jobs`
        );
    }
  });

  /**
   * Handle incoming messages (route to active instance)
   */
  chatProvider.onMessage(async (ctx, text) => {
    // Find instance by channel
    const found = aiBackend.getInstanceByChannel(ctx.channelId);

    if (found) {
      console.log(`[BotEngine] Routing message to instance: ${found.instanceId}`);
      await sendMessageToInstance(ctx, found.instanceId, text);
    }
    // If no instance, ignore the message (don't spam help in every channel)
  });

  /**
   * Handle errors
   */
  chatProvider.onError(async (error, ctx) => {
    console.error('[BotEngine] Error:', error);

    if (ctx) {
      try {
        if (chatProvider.supportsCards) {
          await chatProvider.sendCard(ctx.channelId, {
            title: 'Error',
            color: '#ff0000',
            description: 'An unexpected error occurred. Please try again.'
          });
        } else {
          await ctx.reply('_An unexpected error occurred. Please try again._');
        }
      } catch (e) {
        // Ignore if we can't send error message
      }
    }
  });

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    /**
     * Start the bot
     */
    async start() {
      await chatProvider.initialize();
      await chatProvider.start();
      console.log(`[BotEngine] Started with ${chatProvider.name} provider and ${aiName} backend`);
    },

    /**
     * Stop the bot
     */
    async stop() {
      await chatProvider.stop();
      console.log('[BotEngine] Stopped');
    },

    /**
     * Get the chat provider
     */
    get chatProvider() {
      return chatProvider;
    },

    /**
     * Get the AI backend
     */
    get aiBackend() {
      return aiBackend;
    },

    /**
     * Get list of running instances
     */
    listInstances() {
      return aiBackend.listInstances();
    }
  };
}

module.exports = { createBotEngine };
