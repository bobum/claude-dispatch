/**
 * Job Module
 *
 * Represents a job submitted to run in a Sprite (ephemeral micro-VM).
 * Tracks metadata, status, logs, artifacts, and webhook callbacks.
 */

const { randomUUID } = require('crypto');

const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

class Job {
  /**
   * @param {Object} params
   * @param {string} [params.jobId] - Auto-generated if not provided
   * @param {string} params.repo - GitHub repository (owner/repo)
   * @param {string} [params.branch] - Branch name (default: main)
   * @param {string} params.command - Agent command to execute
   * @param {string} params.channelId - Chat channel ID (provider-agnostic)
   * @param {string} [params.projectDir] - Project directory path
   * @param {string} [params.userId] - User who initiated the job
   * @param {string} [params.image] - Docker image override
   * @param {string} [params.jobToken] - Job-scoped auth token for webhook validation
   * @param {Function} [params.onMessage] - Callback for streaming output: (text) => Promise<void>
   * @param {Function} [params.onComplete] - Callback when job finishes: (job) => Promise<void>
   * @param {number} [params.timeoutMs] - Max job runtime in ms (default: 600000 / 10 min)
   */
  constructor({ jobId, repo, branch, command, channelId, projectDir, userId, image, jobToken, onMessage, onComplete, timeoutMs }) {
    this.jobId = jobId || randomUUID();
    this.repo = repo;
    this.branch = branch || 'main';
    this.command = command;
    this.channelId = channelId;
    this.projectDir = projectDir || null;
    this.userId = userId || null;
    this.image = image || null;
    this.jobToken = jobToken || null;
    this.onMessage = onMessage || null;
    this.onComplete = onComplete || null;
    this.timeoutMs = timeoutMs || 600000;
    this.status = JobStatus.QUEUED;
    this.logs = [];
    this.artifacts = [];
    this.spriteId = null;
    this.machineId = null;
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.lastActivityAt = new Date();
    this.error = null;
    this.exitCode = null;
  }

  /**
   * Mark job as running
   * @param {string} machineId - Fly Machine ID
   */
  start(machineId) {
    this.status = JobStatus.RUNNING;
    this.machineId = machineId;
    this.spriteId = machineId;
    this.startedAt = new Date();
    this.lastActivityAt = new Date();
  }

  /**
   * Mark job as completed
   * @param {number} [exitCode]
   */
  complete(exitCode = 0) {
    this.status = JobStatus.COMPLETED;
    this.completedAt = new Date();
    this.exitCode = exitCode;
    this.lastActivityAt = new Date();
  }

  /**
   * Mark job as failed
   * @param {string} error
   * @param {number} [exitCode]
   */
  fail(error, exitCode = 1) {
    this.status = JobStatus.FAILED;
    this.completedAt = new Date();
    this.error = error;
    this.exitCode = exitCode;
    this.lastActivityAt = new Date();
  }

  /**
   * Append a log entry and update activity timestamp
   * @param {string} message
   * @param {string} [level]
   */
  addLog(message, level = 'info') {
    this.logs.push({
      timestamp: new Date(),
      level,
      message
    });
    this.lastActivityAt = new Date();
  }

  /**
   * Add an artifact
   * @param {Object} artifact
   * @param {string} artifact.name
   * @param {string} artifact.url
   * @param {string} [artifact.type]
   */
  addArtifact({ name, url, type = 'file' }) {
    this.artifacts.push({ name, url, type, addedAt: new Date() });
    this.lastActivityAt = new Date();
  }

  /**
   * Check if job has exceeded its timeout
   * @returns {boolean}
   */
  isTimedOut() {
    if (this.status !== JobStatus.RUNNING) return false;
    return (Date.now() - this.lastActivityAt.getTime()) > this.timeoutMs;
  }

  getDuration() {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return endTime - this.startedAt;
  }

  toSummary() {
    return {
      jobId: this.jobId,
      repo: this.repo,
      branch: this.branch,
      status: this.status,
      duration: this.getDuration(),
      artifactCount: this.artifacts.length,
      logCount: this.logs.length,
      error: this.error
    };
  }

  /**
   * Serialize to JSON (skips callbacks and token)
   */
  toJSON() {
    return {
      jobId: this.jobId,
      repo: this.repo,
      branch: this.branch,
      command: this.command,
      channelId: this.channelId,
      projectDir: this.projectDir,
      userId: this.userId,
      image: this.image,
      status: this.status,
      logs: this.logs,
      artifacts: this.artifacts,
      spriteId: this.spriteId,
      machineId: this.machineId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      lastActivityAt: this.lastActivityAt,
      error: this.error,
      exitCode: this.exitCode,
      timeoutMs: this.timeoutMs
    };
  }

  static fromJSON(json) {
    const job = new Job({
      jobId: json.jobId,
      repo: json.repo,
      branch: json.branch,
      command: json.command,
      channelId: json.channelId,
      projectDir: json.projectDir,
      userId: json.userId,
      image: json.image,
      timeoutMs: json.timeoutMs
    });
    job.status = json.status;
    job.logs = json.logs || [];
    job.artifacts = json.artifacts || [];
    job.spriteId = json.spriteId;
    job.machineId = json.machineId;
    job.createdAt = new Date(json.createdAt);
    job.startedAt = json.startedAt ? new Date(json.startedAt) : null;
    job.completedAt = json.completedAt ? new Date(json.completedAt) : null;
    job.lastActivityAt = json.lastActivityAt ? new Date(json.lastActivityAt) : new Date();
    job.error = json.error;
    job.exitCode = json.exitCode;
    return job;
  }
}

module.exports = { Job, JobStatus };
