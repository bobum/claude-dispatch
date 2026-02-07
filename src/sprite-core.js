/**
 * Sprite Core Module
 *
 * Core logic for running AI agents in Sprites (ephemeral Fly Machines).
 * Follows the same interface as claude-core.js and opencode-core.js
 * for compatibility with the bot-engine.
 *
 * One-shot jobs: Sprite boots, runs agent, POSTs output back via webhooks,
 * and auto-destroys. The sendToInstance Promise resolves when the
 * /webhooks/status webhook fires.
 *
 * Persistent sessions: Sprite stays alive, commands sent via exec API.
 */

const { randomUUID } = require('crypto');
const { Job, JobStatus } = require('./job');
const { SpriteOrchestrator } = require('./sprite-orchestrator');

/**
 * Create an instance manager for Sprite-based agents.
 * @param {Object} options
 * @param {string} [options.apiToken] - Fly API token
 * @param {string} [options.appName] - Fly app name for Sprites
 * @param {string} [options.baseImage] - Default Docker image
 * @param {string} [options.agentType] - 'claude' or 'opencode'
 * @param {SpriteOrchestrator} [options.orchestrator] - For testing
 * @returns {Object} Instance manager
 */
function createInstanceManager(options = {}) {
  const instances = new Map();
  const jobs = new Map();
  const agentType = options.agentType || process.env.SPRITE_AGENT_TYPE || 'claude';

  const orchestrator = options.orchestrator || new SpriteOrchestrator({
    apiToken: options.apiToken,
    appName: options.appName,
    baseImage: options.baseImage
  });

  let staleReaperInterval = null;

  /**
   * Start a new Sprite-based agent instance.
   * @param {string} instanceId
   * @param {string} projectDir - Used as repo for Sprites
   * @param {string} channelId - Chat channel ID (provider-agnostic)
   * @param {Object} [opts]
   * @returns {Promise<Object>} Result with success status
   */
  async function startInstance(instanceId, projectDir, channelId, opts = {}) {
    if (instances.has(instanceId)) {
      return { success: false, error: `Instance "${instanceId}" already running` };
    }

    const sessionId = randomUUID();
    const { persistent = false, image, branch = 'main' } = opts;

    const instance = {
      sessionId,
      channelId,
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

    if (persistent) {
      try {
        const machineInfo = await orchestrator.spawnPersistent({
          repo: projectDir,
          branch,
          image
        });
        instance.spriteId = machineInfo.id;
        return { success: true, sessionId, spriteId: machineInfo.id, persistent: true };
      } catch (error) {
        instances.delete(instanceId);
        return { success: false, error: `Failed to spawn persistent Sprite: ${error.message}` };
      }
    }

    return { success: true, sessionId };
  }

  function stopInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    if (instance.spriteId) {
      orchestrator.stopSprite(instance.spriteId).catch(err => {
        console.error(`[Sprite] Error stopping sprite for ${instanceId}:`, err.message);
      });
    }

    if (instance.currentJob && instance.currentJob.machineId && instance.currentJob.machineId !== instance.spriteId) {
      orchestrator.stopSprite(instance.currentJob.machineId).catch(err => {
        console.error(`[Sprite] Error stopping job machine for ${instanceId}:`, err.message);
      });
    }

    instances.delete(instanceId);
    return { success: true };
  }

  function getInstance(instanceId) {
    return instances.get(instanceId) || null;
  }

  function getInstanceByChannel(channelId) {
    for (const [instanceId, instance] of instances) {
      if (instance.channelId === channelId) {
        return { instanceId, instance };
      }
    }
    return null;
  }

  function listInstances() {
    return Array.from(instances.entries()).map(([instanceId, instance]) => ({
      instanceId,
      ...instance,
      currentJob: instance.currentJob ? instance.currentJob.toSummary() : null
    }));
  }

  function clearInstances() {
    instances.clear();
    jobs.clear();
  }

  function getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  function listJobs() {
    return Array.from(jobs.values()).map(job => job.toSummary());
  }

  /**
   * Send a message to a Sprite-based agent instance.
   *
   * For one-shot mode: spawns a Machine, returns a Promise that resolves
   * when the /webhooks/status webhook fires (not via polling).
   *
   * For persistent mode: sends command via exec API.
   */
  async function sendToInstance(instanceId, message, options = {}) {
    const instance = instances.get(instanceId);
    if (!instance) {
      return { success: false, error: `Instance "${instanceId}" not found` };
    }

    const { onMessage, repo, branch = 'main', image, timeoutMs } = options;
    instance.messageCount++;

    const agentCommand = buildAgentCommand(message, instance.sessionId, agentType);

    // Persistent: exec on existing Machine
    if (instance.persistent && instance.spriteId) {
      return sendToPersistentSprite(instance, agentCommand, onMessage);
    }

    // One-shot: spawn Machine, wait for webhook callback
    return sendToNewSprite(instance, agentCommand, { onMessage, repo, branch, image, timeoutMs });
  }

  async function sendToPersistentSprite(instance, command, onMessage) {
    const job = new Job({
      repo: instance.projectDir,
      branch: instance.branch,
      command,
      channelId: instance.channelId,
      projectDir: instance.projectDir,
      image: instance.image
    });

    jobs.set(job.jobId, job);
    instance.currentJob = job;
    job.start(instance.spriteId);

    try {
      if (onMessage) {
        await onMessage(`Sending to Sprite ${instance.spriteId.substring(0, 8)}...`).catch(() => {});
      }

      const result = await orchestrator.streamCommand(
        instance.spriteId,
        command,
        (output) => {
          job.addLog(output);
          if (onMessage) {
            onMessage(output).catch(err => {
              console.error('[Sprite] onMessage error:', err.message);
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
      return { success: false, error: error.message, jobId: job.jobId };
    }
  }

  /**
   * One-shot mode: spawn a Machine and wait for webhook completion.
   * The Promise resolves when /webhooks/status fires with completed/failed.
   */
  async function sendToNewSprite(instance, agentCommand, options) {
    const { onMessage, repo, branch = 'main', image, timeoutMs = 600000 } = options;

    const jobToken = orchestrator.generateJobToken(randomUUID());

    const job = new Job({
      repo: repo || instance.projectDir || '',
      branch,
      command: agentCommand,
      channelId: instance.channelId,
      projectDir: instance.projectDir,
      image,
      jobToken,
      onMessage,
      timeoutMs
    });

    // Guard against both completion and timeout resolving the race
    let resolved = false;

    // Create a Promise that resolves when the webhook status fires
    const completionPromise = new Promise((resolve) => {
      job.onComplete = (completedJob) => {
        if (resolved) return;
        resolved = true;
        instance.currentJob = null;
        resolve({
          success: completedJob.status === JobStatus.COMPLETED,
          responses: completedJob.logs.map(l => l.message),
          jobId: completedJob.jobId,
          artifacts: completedJob.artifacts,
          exitCode: completedJob.exitCode,
          streamed: true
        });
      };
    });

    jobs.set(job.jobId, job);
    instance.currentJob = job;

    try {
      const machineInfo = await orchestrator.spawnJob(job);

      if (onMessage) {
        await onMessage(`Job ${job.jobId.substring(0, 8)} started (Machine ${machineInfo.id.substring(0, 8)})`).catch(() => {});
      }

      // Wait for webhook to fire (or timeout)
      let timeoutTimer;
      const timeoutPromise = new Promise((resolve) => {
        timeoutTimer = setTimeout(() => {
          if (resolved) return;
          if (job.status === JobStatus.RUNNING) {
            resolved = true;
            job.fail('Job timed out');
            instance.currentJob = null;
            resolve({
              success: false,
              error: 'Job timed out',
              jobId: job.jobId
            });
          }
        }, job.timeoutMs);
      });

      const result = await Promise.race([completionPromise, timeoutPromise]);
      clearTimeout(timeoutTimer);
      return result;
    } catch (error) {
      job.fail(error.message);
      instance.currentJob = null;
      return { success: false, error: error.message, jobId: job.jobId };
    }
  }

  /**
   * Shell-escape a string for safe embedding in double-quoted shell arguments.
   * Escapes all characters that could be used for shell injection:
   *   \ → \\     (backslash)
   *   $ → \$     (parameter/command expansion)
   *   ` → \`     (command substitution)
   *   " → \"     (close quote)
   *   ! → \!     (bash history expansion)
   * @param {string} str
   * @returns {string}
   */
  function shellEscape(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/"/g, '\\"')
      .replace(/!/g, '\\!');
  }

  function buildAgentCommand(message, sessionId, type) {
    const escapedMessage = shellEscape(message);
    const escapedSessionId = shellEscape(sessionId);

    if (type === 'opencode') {
      return `test -f /etc/opencode/opencode.json && ! test -f /workspace/opencode.json && cp /etc/opencode/opencode.json /workspace/opencode.json; NO_COLOR=1 opencode run -- "${escapedMessage}" 2>&1 | perl -pe 's/\\x1b\\[[0-9;]*[a-zA-Z]//g'`;
    }

    return `claude --dangerously-skip-permissions --output-format stream-json --session-id "${escapedSessionId}" -p "${escapedMessage}"`;
  }

  // buildArgs constructs an argv array for direct process execution,
  // so we must not apply shell-style escaping here. The raw strings
  // are passed as-is to the underlying CLI.
  function buildArgs(message, sessionId) {
    if (agentType === 'opencode') {
      return ['run', '--format', 'json', '--session', sessionId, '--', message];
    }
    return [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--session-id', sessionId,
      '-p', message
    ];
  }

  /**
   * Start the stale job reaper.
   * Runs every 60s, marks timed-out running jobs as failed.
   */
  function startStaleReaper() {
    if (staleReaperInterval) return;
    staleReaperInterval = setInterval(() => {
      for (const [jobId, job] of jobs) {
        if (job.isTimedOut()) {
          console.warn(`[Sprite] Job ${jobId} timed out, marking failed`);
          job.fail('Job timed out (stale reaper)');

          // Clear instance.currentJob reference to prevent stale references
          for (const [, instance] of instances) {
            if (instance.currentJob && instance.currentJob.jobId === jobId) {
              instance.currentJob = null;
            }
          }

          if (job.onComplete) {
            Promise.resolve(job.onComplete(job)).catch(e => {
              console.error(`[Sprite] onComplete error during reap:`, e.message);
            });
          }
          // Clean up the Machine
          if (job.machineId) {
            orchestrator.destroyMachine(job.machineId).catch(() => {});
          }
          // Remove completed job from map to prevent memory leaks
          jobs.delete(jobId);
        }
      }
    }, 60000);
  }

  function stopStaleReaper() {
    if (staleReaperInterval) {
      clearInterval(staleReaperInterval);
      staleReaperInterval = null;
    }
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
    buildAgentCommand,
    getJob,
    listJobs,
    startStaleReaper,
    stopStaleReaper,
    get instances() { return instances; },
    get jobs() { return jobs; },
    get orchestrator() { return orchestrator; }
  };
}

module.exports = { createInstanceManager };
