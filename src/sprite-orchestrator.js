/**
 * Sprite Orchestrator Module
 *
 * Handles spawning and managing ephemeral micro-VMs (Sprites) for running
 * AI coding agents in isolated environments.
 *
 * Sprites are event-driven, usage-billed VMs that auto-sleep when idle.
 * They provide clean, isolated environments per job.
 */

const EventEmitter = require('events');

/**
 * SpriteOrchestrator manages the lifecycle of Sprite VMs
 */
class SpriteOrchestrator extends EventEmitter {
  /**
   * Create a SpriteOrchestrator
   * @param {Object} options - Configuration options
   * @param {string} options.apiToken - Sprite API token (SPRITE_API_TOKEN)
   * @param {string} [options.baseUrl] - Sprite API base URL
   * @param {string} [options.baseImage] - Base Docker image for Sprites
   * @param {string} [options.region] - Preferred region for Sprites
   * @param {Function} [options.fetchFn] - Optional fetch function for testing
   */
  constructor(options = {}) {
    super();
    this.apiToken = options.apiToken || process.env.SPRITE_API_TOKEN;
    this.baseUrl = options.baseUrl || process.env.SPRITE_API_URL || 'https://api.sprites.dev/v1';
    this.baseImage = options.baseImage || process.env.SPRITE_BASE_IMAGE || 'open-dispatch/agent:latest';
    this.region = options.region || process.env.SPRITE_REGION || 'iad';
    this.fetchFn = options.fetchFn || fetch;

    if (!this.apiToken) {
      console.warn('[SpriteOrchestrator] No API token provided. Set SPRITE_API_TOKEN environment variable.');
    }
  }

  /**
   * Spawn a new Sprite for a job
   * @param {Job} job - The job to run
   * @param {Object} [options] - Spawn options
   * @param {number} [options.timeoutMs] - Max runtime in milliseconds
   * @param {Object} [options.env] - Additional environment variables
   * @returns {Promise<Object>} Sprite info with id, status
   */
  async spawnJob(job, options = {}) {
    const { timeoutMs = 600000, env = {} } = options;

    // Use job-specific image if provided, otherwise fall back to default
    const image = job.image || this.baseImage;

    const command = this._buildCommand(job);
    const spriteEnv = {
      JOB_ID: job.jobId,
      REPO: job.repo,
      BRANCH: job.branch,
      SLACK_CHANNEL: job.slackChannel,
      COMMAND: job.command,
      ...env
    };

    try {
      const response = await this.fetchFn(`${this.baseUrl}/sprites`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: image,
          command: command,
          env: spriteEnv,
          region: this.region,
          timeout_ms: timeoutMs
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sprite API error: ${response.status} - ${errorText}`);
      }

      const spriteInfo = await response.json();

      job.start(spriteInfo.id);
      this.emit('sprite:started', { job, spriteInfo });

      return spriteInfo;
    } catch (error) {
      job.fail(error.message);
      this.emit('sprite:error', { job, error });
      throw error;
    }
  }

  /**
   * Build the command to run inside the Sprite
   * @param {Job} job - The job
   * @returns {string[]} Command array
   */
  _buildCommand(job) {
    // Command is an array for exec-style spawning
    // The entrypoint script will handle git clone, checkout, and running the agent
    return [
      '/bin/sh', '-c',
      `
        set -e
        echo "[Sprite] Starting job ${job.jobId}"

        # Clone repository
        git clone --depth 1 --branch ${this._escapeShell(job.branch)} ${this._escapeShell(job.repo)} /workspace || {
          git clone ${this._escapeShell(job.repo)} /workspace
          cd /workspace
          git checkout ${this._escapeShell(job.branch)} || git checkout -b ${this._escapeShell(job.branch)}
        }

        cd /workspace
        echo "[Sprite] Repository cloned, running command"

        # Run the agent command
        ${job.command}

        echo "[Sprite] Command completed"
      `.trim()
    ];
  }

  /**
   * Escape a string for shell use
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  _escapeShell(str) {
    if (!str) return '""';
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Get the status of a Sprite
   * @param {string} spriteId - Sprite ID
   * @returns {Promise<Object>} Sprite status
   */
  async getSpriteStatus(spriteId) {
    const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get sprite status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Stream logs from a Sprite
   * @param {string} spriteId - Sprite ID
   * @param {Function} onLog - Callback for each log line: (log: string) => void
   * @returns {Promise<void>}
   */
  async streamLogs(spriteId, onLog) {
    const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/logs`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to stream logs: ${response.status}`);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            onLog(line);
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        onLog(buffer);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Wait for a Sprite to complete
   * @param {string} spriteId - Sprite ID
   * @param {Object} [options] - Options
   * @param {number} [options.pollIntervalMs] - Poll interval in ms
   * @param {number} [options.timeoutMs] - Max wait time in ms
   * @returns {Promise<Object>} Final sprite status
   */
  async waitForCompletion(spriteId, options = {}) {
    const { pollIntervalMs = 5000, timeoutMs = 600000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getSpriteStatus(spriteId);

      if (status.state === 'completed' || status.state === 'failed' || status.state === 'stopped') {
        return status;
      }

      await this._sleep(pollIntervalMs);
    }

    throw new Error(`Sprite ${spriteId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Stop a running Sprite
   * @param {string} spriteId - Sprite ID
   * @returns {Promise<Object>} Stop result
   */
  async stopSprite(spriteId) {
    const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to stop sprite: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get artifacts from a completed Sprite
   * @param {string} spriteId - Sprite ID
   * @returns {Promise<Object[]>} List of artifacts
   */
  async getArtifacts(spriteId) {
    const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/artifacts`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get artifacts: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Upload artifacts to persistent storage
   * @param {string} spriteId - Sprite ID
   * @param {string} artifactPath - Path pattern for artifacts (e.g., "artifacts/*")
   * @returns {Promise<Object[]>} Uploaded artifact URLs
   */
  async uploadArtifacts(spriteId, artifactPath = 'artifacts/*') {
    const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/artifacts/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: artifactPath })
    });

    if (!response.ok) {
      throw new Error(`Failed to upload artifacts: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // PERSISTENT SPRITE METHODS
  // ============================================

  /**
   * Spawn a persistent Sprite that stays alive for multiple commands
   * @param {Object} options - Spawn options
   * @param {string} options.repo - Repository URL
   * @param {string} [options.branch] - Branch name
   * @param {string} [options.image] - Docker image
   * @param {Object} [options.env] - Additional environment variables
   * @param {number} [options.idleTimeoutMs] - Idle timeout before sleep (default: 30 minutes)
   * @returns {Promise<Object>} Sprite info with id
   */
  async spawnPersistent(options = {}) {
    const {
      repo,
      branch = 'main',
      image,
      env = {},
      idleTimeoutMs = 1800000 // 30 minutes
    } = options;

    const spriteImage = image || this.baseImage;

    // Persistent Sprites run a long-lived entrypoint that:
    // 1. Clones the repo
    // 2. Listens for commands via the Sprite exec API
    // The command here just sets up the workspace and keeps the container alive
    const setupCommand = [
      '/bin/sh', '-c',
      `
        set -e
        echo "[Sprite] Setting up persistent workspace"

        # Clone repository
        git clone --branch ${this._escapeShell(branch)} ${this._escapeShell(repo)} /workspace || {
          git clone ${this._escapeShell(repo)} /workspace
          cd /workspace
          git checkout ${this._escapeShell(branch)} || git checkout -b ${this._escapeShell(branch)}
        }

        cd /workspace
        echo "[Sprite] Workspace ready at /workspace"
        echo "[Sprite] Waiting for commands..."

        # Keep alive - the Sprite will auto-sleep when idle
        # Commands are sent via the exec API
        while true; do
          sleep 60
        done
      `.trim()
    ];

    try {
      const response = await this.fetchFn(`${this.baseUrl}/sprites`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: spriteImage,
          command: setupCommand,
          env: {
            REPO: repo,
            BRANCH: branch,
            PERSISTENT: 'true',
            ...env
          },
          region: this.region,
          idle_timeout_ms: idleTimeoutMs,
          // No hard timeout - sprite stays alive until stopped
          timeout_ms: 0
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sprite API error: ${response.status} - ${errorText}`);
      }

      const spriteInfo = await response.json();
      this.emit('sprite:persistent:started', { spriteInfo, repo, branch });

      return spriteInfo;
    } catch (error) {
      this.emit('sprite:error', { error });
      throw error;
    }
  }

  /**
   * Send a command to an existing Sprite via exec API
   * @param {string} spriteId - Sprite ID
   * @param {string} command - Command to execute
   * @param {Object} [options] - Options
   * @param {string} [options.workdir] - Working directory (default: /workspace)
   * @param {Object} [options.env] - Additional environment variables
   * @returns {Promise<Object>} Exec result with output
   */
  async sendCommand(spriteId, command, options = {}) {
    const { workdir = '/workspace', env = {} } = options;

    try {
      // First, wake the sprite if it's sleeping
      await this.wakeSprite(spriteId);

      const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/exec`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: ['/bin/sh', '-c', `cd ${workdir} && ${command}`],
          env
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sprite exec error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      this.emit('sprite:exec:completed', { spriteId, command, result });

      return result;
    } catch (error) {
      this.emit('sprite:exec:error', { spriteId, command, error });
      throw error;
    }
  }

  /**
   * Stream command output from a Sprite exec
   * @param {string} spriteId - Sprite ID
   * @param {string} command - Command to execute
   * @param {Function} onOutput - Callback for output: (data: string) => void
   * @param {Object} [options] - Options
   * @returns {Promise<Object>} Final exec result
   */
  async streamCommand(spriteId, command, onOutput, options = {}) {
    const { workdir = '/workspace', env = {} } = options;

    try {
      // Wake the sprite if sleeping
      await this.wakeSprite(spriteId);

      const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/exec`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: ['/bin/sh', '-c', `cd ${workdir} && ${command}`],
          env,
          stream: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sprite exec error: ${response.status} - ${errorText}`);
      }

      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let exitCode = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              // Check for exit code in final message
              try {
                const parsed = JSON.parse(line);
                if (parsed.exit_code !== undefined) {
                  exitCode = parsed.exit_code;
                } else if (parsed.output) {
                  onOutput(parsed.output);
                }
              } catch {
                onOutput(line);
              }
            }
          }
        }

        if (buffer.trim()) {
          onOutput(buffer);
        }
      } finally {
        reader.releaseLock();
      }

      return { success: exitCode === 0, exitCode };
    } catch (error) {
      this.emit('sprite:exec:error', { spriteId, command, error });
      throw error;
    }
  }

  /**
   * Wake a sleeping Sprite
   * @param {string} spriteId - Sprite ID
   * @returns {Promise<Object>} Wake result
   */
  async wakeSprite(spriteId) {
    try {
      const status = await this.getSpriteStatus(spriteId);

      if (status.state === 'sleeping' || status.state === 'suspended') {
        const response = await this.fetchFn(`${this.baseUrl}/sprites/${spriteId}/wake`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to wake sprite: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        this.emit('sprite:woken', { spriteId, result });

        // Wait a bit for the sprite to fully wake
        await this._sleep(1000);

        return result;
      }

      // Already awake
      return { state: status.state, alreadyAwake: true };
    } catch (error) {
      // If sprite doesn't exist or is stopped, this will fail
      // Let the caller handle it
      throw error;
    }
  }
}

module.exports = { SpriteOrchestrator };
