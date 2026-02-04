/**
 * Sprite Core Module
 *
 * Contains the core logic for running AI agents in Sprites (ephemeral micro-VMs).
 * Follows the same interface as claude-core.js and opencode-core.js for
 * compatibility with the bot-engine.
 *
 * Instead of spawning local processes, this module spawns Sprites via the
 * SpriteOrchestrator and streams results back.
 */

const { randomUUID } = require('crypto');
const { Job, JobStatus } = require('./job');
const { SpriteOrchestrator } = require('./sprite-orchestrator');

/**
 * Create an instance manager for Sprite-based agents
 * @param {Object} options - Configuration options
 * @param {string} [options.apiToken] - Sprite API token
 * @param {string} [options.baseUrl] - Sprite API base URL
 * @param {string} [options.baseImage] - Base Docker image for Sprites
 * @param {string} [options.agentType] - Agent to run: 'claude' or 'opencode'
 * @param {SpriteOrchestrator} [options.orchestrator] - Optional orchestrator instance for testing
 * @returns {Object} Instance manager with methods
 */
function createInstanceManager(options = {}) {
  const instances = new Map();
  const jobs = new Map();
  const agentType = options.agentType || process.env.SPRITE_AGENT_TYPE || 'claude';

  const orchestrator = options.orchestrator || new SpriteOrchestrator({
    apiToken: options.apiToken,
    baseUrl: options.baseUrl,
    baseImage: options.baseImage
  });

  /**
   * Start a new Sprite-based agent instance
   * @param {string} instanceId - Instance identifier
   * @param {string} projectDir - Project directory (used as repo for Sprites)
   * @param {string} channel - Chat channel ID
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.persistent] - If true, spawn a long-running Sprite
   * @param {string} [options.image] - Docker image to use
   * @param {string} [options.branch] - Branch to checkout
   * @returns {Object|Promise<Object>} Result with success status
   */
  function startInstance(instanceId, projectDir, channel, options = {}) {
    if (instances.has(instanceId)) {
      return { success: false, error: `Instance "${instanceId}" already running` };
    }

    const sessionId = randomUUID();
    const { persistent = false, image, branch = 'main' } = options;

    const instance = {
      sessionId,
      channel,
      projectDir,
      messageCount: 0,
      startedAt: new Date(),
      currentJob: null,
      persistent,
      spriteId: null,
      image,
      branch
    };

    instances.set(instanceId, instance);

    // For persistent mode, spawn the Sprite immediately
    if (persistent) {
      return spawnPersistentSprite(instanceId, instance);
    }

    return { success: true, sessionId };
  }

  /**
   * Spawn a persistent Sprite for an instance
   * @param {string} instanceId - Instance ID
   * @param {Object} instance - Instance data
   * @returns {Promise<Object>} Result with success status
   */
  async function spawnPersistentSprite(instanceId, instance) {
    try {
      const spriteInfo = await orchestrator.spawnPersistent({
        repo: instance.projectDir,
        branch: instance.branch,
        image: instance.image
      });

      instance.spriteId = spriteInfo.id;

      return {
        success: true,
        sessionId: instance.sessionId,
        spriteId: spriteInfo.id,
        persistent: true
      };
    } catch (error) {
      instances.delete(instanceId);
      return {
        success: false,
        error: `Failed to spawn persistent Sprite: ${error.message}`
      };
    }
  }

  /**
   * Stop a Sprite-based agent instance
   * @param {string} instanceId - Instance identifier
   * @returns {Object} Result with success status
   */
  function stopInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    // Stop the persistent Sprite if one exists
    if (instance.spriteId) {
      orchestrator.stopSprite(instance.spriteId).catch(err => {
        console.error(`[Sprite] Error stopping persistent sprite for ${instanceId}:`, err);
      });
    }

    // Stop any running job's sprite
    if (instance.currentJob && instance.currentJob.spriteId && instance.currentJob.spriteId !== instance.spriteId) {
      orchestrator.stopSprite(instance.currentJob.spriteId).catch(err => {
        console.error(`[Sprite] Error stopping job sprite for ${instanceId}:`, err);
      });
    }

    instances.delete(instanceId);
    return { success: true };
  }

  /**
   * Get an instance by ID
   * @param {string} instanceId - Instance identifier
   * @returns {Object|null} Instance or null
   */
  function getInstance(instanceId) {
    return instances.get(instanceId) || null;
  }

  /**
   * Find instance by channel
   * @param {string} channelId - Channel identifier
   * @returns {Object|null} Instance info or null
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
   * @returns {Array} Array of instance info
   */
  function listInstances() {
    return Array.from(instances.entries()).map(([instanceId, instance]) => ({
      instanceId,
      ...instance,
      currentJob: instance.currentJob ? instance.currentJob.toSummary() : null
    }));
  }

  /**
   * Clear all instances (useful for testing)
   */
  function clearInstances() {
    instances.clear();
    jobs.clear();
  }

  /**
   * Get a job by ID
   * @param {string} jobId - Job identifier
   * @returns {Job|null} Job or null
   */
  function getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  /**
   * List all jobs
   * @returns {Array} Array of job summaries
   */
  function listJobs() {
    return Array.from(jobs.values()).map(job => job.toSummary());
  }

  /**
   * Send a message to a Sprite-based agent instance
   * @param {string} instanceId - Instance ID
   * @param {string} message - Message/command to send
   * @param {Object} options - Optional settings
   * @param {Function} [options.onMessage] - Callback for streaming messages
   * @param {string} [options.repo] - Repository URL (overrides projectDir)
   * @param {string} [options.branch] - Branch name
   * @param {string} [options.image] - Docker image to use for this job
   * @returns {Promise<Object>} Result with success, responses, jobId
   */
  async function sendToInstance(instanceId, message, options = {}) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    const { onMessage, repo, branch = 'main', image } = options;
    instance.messageCount++;

    // Build the agent command based on type
    const agentCommand = buildAgentCommand(message, instance.sessionId, agentType);

    // For persistent sessions, use the existing Sprite
    if (instance.persistent && instance.spriteId) {
      return sendToPersistentSprite(instance, agentCommand, onMessage);
    }

    // For one-shot mode, spawn a new Sprite for each message
    return sendToNewSprite(instance, message, agentCommand, options);
  }

  /**
   * Send a command to a persistent Sprite
   * @param {Object} instance - Instance data
   * @param {string} command - Agent command to run
   * @param {Function} onMessage - Message callback
   * @returns {Promise<Object>} Result
   */
  async function sendToPersistentSprite(instance, command, onMessage) {
    const job = new Job({
      repo: instance.projectDir,
      branch: instance.branch,
      command,
      slackChannel: instance.channel,
      projectDir: instance.projectDir,
      image: instance.image
    });

    jobs.set(job.jobId, job);
    instance.currentJob = job;
    job.start(instance.spriteId);

    try {
      if (onMessage) {
        onMessage(`📤 Sending to Sprite ${instance.spriteId.substring(0, 8)}...`).catch(() => {});
      }

      // Use streamCommand for persistent Sprites
      const result = await orchestrator.streamCommand(
        instance.spriteId,
        command,
        (output) => {
          job.addLog(output);
          if (onMessage) {
            onMessage(output).catch(err => {
              console.error('[Sprite] Error in onMessage callback:', err);
            });
          }
        }
      );

      if (result.success) {
        job.complete(result.exitCode);
      } else {
        job.fail('Command failed', result.exitCode);
      }

      instance.currentJob = null;

      return {
        success: result.success,
        responses: job.logs.map(l => l.message),
        jobId: job.jobId,
        exitCode: result.exitCode,
        streamed: true,
        persistent: true
      };
    } catch (error) {
      job.fail(error.message);
      instance.currentJob = null;

      return {
        success: false,
        error: error.message,
        jobId: job.jobId
      };
    }
  }

  /**
   * Send a message by spawning a new Sprite (one-shot mode)
   * @param {Object} instance - Instance data
   * @param {string} message - Original user message
   * @param {string} agentCommand - Built agent command
   * @param {Object} options - Options including onMessage, repo, branch, image
   * @returns {Promise<Object>} Result
   */
  async function sendToNewSprite(instance, message, agentCommand, options) {
    const { onMessage, repo, branch = 'main', image } = options;

    // Create a job for this message
    const job = new Job({
      repo: repo || instance.projectDir,
      branch,
      command: agentCommand,
      slackChannel: instance.channel,
      projectDir: instance.projectDir,
      image
    });

    jobs.set(job.jobId, job);
    instance.currentJob = job;

    try {
      // Spawn the sprite
      const spriteInfo = await orchestrator.spawnJob(job);

      if (onMessage) {
        onMessage(`🚀 Job ${job.jobId} started in Sprite ${spriteInfo.id}`).catch(err => {
          console.error('[Sprite] Error in onMessage callback:', err);
        });
      }

      // Stream logs back to the caller
      const logPromise = streamJobLogs(job, spriteInfo.id, onMessage);

      // Wait for completion
      const finalStatus = await orchestrator.waitForCompletion(spriteInfo.id);

      // Wait for log streaming to finish
      await logPromise.catch(err => {
        console.error('[Sprite] Error streaming logs:', err);
      });

      // Collect artifacts
      try {
        const artifacts = await orchestrator.getArtifacts(spriteInfo.id);
        for (const artifact of artifacts) {
          job.addArtifact(artifact);
        }
      } catch (err) {
        console.error('[Sprite] Error collecting artifacts:', err);
      }

      // Update job status
      if (finalStatus.state === 'completed' && finalStatus.exit_code === 0) {
        job.complete(finalStatus.exit_code);
      } else {
        job.fail(finalStatus.error || 'Sprite execution failed', finalStatus.exit_code);
      }

      instance.currentJob = null;

      return {
        success: job.status === JobStatus.COMPLETED,
        responses: job.logs.map(l => l.message),
        jobId: job.jobId,
        artifacts: job.artifacts,
        exitCode: job.exitCode,
        streamed: true
      };
    } catch (error) {
      job.fail(error.message);
      instance.currentJob = null;

      return {
        success: false,
        error: error.message,
        jobId: job.jobId
      };
    }
  }

  /**
   * Stream logs from a job's sprite
   * @param {Job} job - The job
   * @param {string} spriteId - Sprite ID
   * @param {Function} onMessage - Message callback
   */
  async function streamJobLogs(job, spriteId, onMessage) {
    if (!onMessage) return;

    try {
      await orchestrator.streamLogs(spriteId, (log) => {
        job.addLog(log);
        onMessage(log).catch(err => {
          console.error('[Sprite] Error in onMessage callback:', err);
        });
      });
    } catch (err) {
      // Log streaming may fail if sprite completes before we start streaming
      console.warn('[Sprite] Log streaming ended:', err.message);
    }
  }

  /**
   * Build the agent command to run inside the Sprite
   * @param {string} message - User message
   * @param {string} sessionId - Session ID for continuity
   * @param {string} type - Agent type ('claude' or 'opencode')
   * @returns {string} Shell command
   */
  function buildAgentCommand(message, sessionId, type) {
    const escapedMessage = message.replace(/'/g, "'\\''");

    if (type === 'opencode') {
      return `opencode run --format json --session '${sessionId}' -- '${escapedMessage}'`;
    }

    // Default to Claude
    return `claude --dangerously-skip-permissions --output-format stream-json --session-id '${sessionId}' -p '${escapedMessage}'`;
  }

  /**
   * Build CLI arguments (for interface compatibility)
   */
  function buildArgs(message, projectDir, sessionId, isFirstMessage) {
    // For Sprites, we don't use local CLI args, but return the remote command
    return buildAgentCommand(message, sessionId, agentType).split(' ');
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
    getJob,
    listJobs,
    get instances() { return instances; },
    get jobs() { return jobs; },
    get orchestrator() { return orchestrator; }
  };
}

/**
 * Chunk text for message limits
 * @param {string} text - Text to chunk
 * @param {number} maxLength - Maximum chunk length
 * @returns {string[]} Array of chunks
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
  chunkText
};
