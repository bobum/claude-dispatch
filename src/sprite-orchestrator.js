/**
 * Sprite Orchestrator Module
 *
 * Manages ephemeral Fly Machines (Sprites) for running AI coding agents.
 * Uses the Fly Machines API (api.machines.dev) — not the fictional sprites.dev.
 *
 * Communication pattern: Sprites POST output back to Open-Dispatch via
 * HTTP webhooks over Fly.io private networking. No polling for logs/status.
 */

const { randomUUID, createHmac } = require('crypto');
const EventEmitter = require('events');

class SpriteOrchestrator extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.apiToken - Fly.io API token (FLY_API_TOKEN)
   * @param {string} options.appName - Fly app name for Sprites (FLY_SPRITE_APP)
   * @param {string} [options.baseUrl] - Machines API base URL
   * @param {string} [options.baseImage] - Default Docker image for Sprites (SPRITE_IMAGE)
   * @param {string} [options.openDispatchUrl] - Webhook callback URL
   * @param {string} [options.region] - Preferred Fly region
   * @param {Function} [options.fetchFn] - Fetch implementation (for testing)
   */
  constructor(options = {}) {
    super();
    this.apiToken = options.apiToken || process.env.FLY_API_TOKEN;
    this.appName = options.appName || process.env.FLY_SPRITE_APP;
    this.baseUrl = options.baseUrl || 'https://api.machines.dev/v1';
    this.baseImage = options.baseImage || process.env.SPRITE_IMAGE || 'open-dispatch/agent:latest';
    this.openDispatchUrl = options.openDispatchUrl || process.env.OPEN_DISPATCH_URL || 'http://open-dispatch.internal:8080';
    this.region = options.region || process.env.FLY_REGION || 'iad';
    this.fetchFn = options.fetchFn || fetch;
    this.tokenSecret = options.tokenSecret || process.env.JOB_TOKEN_SECRET || randomUUID();

    if (!this.apiToken) {
      console.warn('[SpriteOrchestrator] No API token. Set FLY_API_TOKEN.');
    }
    if (!this.appName) {
      console.warn('[SpriteOrchestrator] No app name. Set FLY_SPRITE_APP.');
    }
  }

  _machinesUrl(path = '') {
    return `${this.baseUrl}/apps/${this.appName}/machines${path}`;
  }

  _headers(contentType = true) {
    const h = { 'Authorization': `Bearer ${this.apiToken}` };
    if (contentType) h['Content-Type'] = 'application/json';
    return h;
  }

  /**
   * Generate a job-scoped auth token for webhook validation.
   * @param {string} jobId
   * @returns {string}
   */
  generateJobToken(jobId) {
    return createHmac('sha256', this.tokenSecret).update(jobId).digest('hex');
  }

  /**
   * Spawn a new Fly Machine for a one-shot job.
   * The Machine runs sprite-reporter which POSTs output back via webhooks.
   *
   * @param {import('./job').Job} job
   * @param {Object} [options]
   * @param {Object} [options.env] - Additional env vars
   * @returns {Promise<Object>} Machine info { id, state, ... }
   */
  async spawnJob(job, options = {}) {
    const { env = {} } = options;
    const image = job.image || this.baseImage;

    const machineEnv = {
      JOB_ID: job.jobId,
      JOB_TOKEN: job.jobToken,
      OPEN_DISPATCH_URL: this.openDispatchUrl,
      REPO: job.repo || '',
      BRANCH: job.branch || 'main',
      COMMAND: job.command || '',
      GH_TOKEN: process.env.GH_TOKEN || '',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      ...env
    };

    if (process.env.DATABASE_URL) {
      machineEnv.DATABASE_URL = process.env.DATABASE_URL;
    }

    try {
      const response = await this.fetchFn(this._machinesUrl(), {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          region: this.region,
          config: {
            image,
            env: machineEnv,
            auto_destroy: true,
            restart: { policy: 'no' },
            guest: {
              cpu_kind: 'shared',
              cpus: 2,
              memory_mb: 2048
            }
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Machines API ${response.status}: ${errorText}`);
      }

      const machineInfo = await response.json();
      job.start(machineInfo.id);
      this.emit('sprite:started', { job, machineInfo });
      return machineInfo;
    } catch (error) {
      job.fail(error.message);
      this.emit('sprite:error', { job, error });
      throw error;
    }
  }

  /**
   * Spawn a persistent Machine that stays alive for multiple exec calls.
   * @param {Object} options
   * @returns {Promise<Object>} Machine info
   */
  async spawnPersistent(options = {}) {
    const { repo, branch = 'main', image, env = {} } = options;
    const spriteImage = image || this.baseImage;

    try {
      const response = await this.fetchFn(this._machinesUrl(), {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          region: this.region,
          config: {
            image: spriteImage,
            env: {
              REPO: repo || '',
              BRANCH: branch,
              PERSISTENT: 'true',
              OPEN_DISPATCH_URL: this.openDispatchUrl,
              GH_TOKEN: process.env.GH_TOKEN || '',
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
              ...env
            },
            auto_destroy: false,
            restart: { policy: 'always' },
            guest: {
              cpu_kind: 'shared',
              cpus: 2,
              memory_mb: 2048
            }
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Machines API ${response.status}: ${errorText}`);
      }

      const machineInfo = await response.json();
      this.emit('sprite:persistent:started', { machineInfo, repo, branch });
      return machineInfo;
    } catch (error) {
      this.emit('sprite:error', { error });
      throw error;
    }
  }

  /**
   * Get Machine status.
   * @param {string} machineId
   * @returns {Promise<Object>}
   */
  async getSpriteStatus(machineId) {
    const response = await this.fetchFn(this._machinesUrl(`/${machineId}`), {
      headers: this._headers(false)
    });
    if (!response.ok) {
      throw new Error(`Failed to get machine status: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Stop a Machine.
   * @param {string} machineId
   * @returns {Promise<Object>}
   */
  async stopSprite(machineId) {
    const response = await this.fetchFn(this._machinesUrl(`/${machineId}/stop`), {
      method: 'POST',
      headers: this._headers(false)
    });
    if (!response.ok) {
      throw new Error(`Failed to stop machine: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Start (wake) a stopped Machine.
   * @param {string} machineId
   * @returns {Promise<Object>}
   */
  async wakeSprite(machineId) {
    const response = await this.fetchFn(this._machinesUrl(`/${machineId}/start`), {
      method: 'POST',
      headers: this._headers(false)
    });
    if (!response.ok) {
      throw new Error(`Failed to start machine: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Execute a command inside a running Machine.
   * @param {string} machineId
   * @param {string} command
   * @param {Object} [options]
   * @returns {Promise<Object>} { stdout, stderr, exit_code }
   */
  async sendCommand(machineId, command, options = {}) {
    const { workdir = '/workspace', env } = options;

    const response = await this.fetchFn(this._machinesUrl(`/${machineId}/exec`), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        command: ['/bin/sh', '-c', `cd ${workdir} && ${command}`],
        ...(env && { env })
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exec error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Execute a command and deliver output line-by-line via callback.
   * Fly exec is not streaming — we run sendCommand then split the result.
   *
   * @param {string} machineId
   * @param {string} command
   * @param {Function} onOutput - (line: string) => void
   * @param {Object} [options]
   * @returns {Promise<Object>} { success, exitCode }
   */
  async streamCommand(machineId, command, onOutput, options = {}) {
    try {
      await this.wakeSprite(machineId).catch(() => {});
      const result = await this.sendCommand(machineId, command, options);

      if (result.stdout) {
        for (const line of result.stdout.split('\n')) {
          if (line.trim()) onOutput(line);
        }
      }
      if (result.stderr) {
        for (const line of result.stderr.split('\n')) {
          if (line.trim()) onOutput(`[stderr] ${line}`);
        }
      }

      const exitCode = result.exit_code || 0;
      return { success: exitCode === 0, exitCode };
    } catch (error) {
      this.emit('sprite:exec:error', { machineId, command, error });
      throw error;
    }
  }

  /**
   * Destroy a Machine (cleanup).
   * @param {string} machineId
   * @returns {Promise<void>}
   */
  async destroyMachine(machineId) {
    const response = await this.fetchFn(this._machinesUrl(`/${machineId}`), {
      method: 'DELETE',
      headers: this._headers(false)
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to destroy machine: ${response.status}`);
    }
  }
}

module.exports = { SpriteOrchestrator };
