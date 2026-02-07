/**
 * Tests for the webhook server
 *
 * Starts a real HTTP server on a random port and sends requests to it.
 * Verifies routing, auth, and callback behavior.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createWebhookServer } = require('../src/webhook-server');
const { Job, JobStatus } = require('../src/job');

function post(port, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
      });
    }).on('error', reject);
  });
}

describe('Webhook Server', () => {
  let jobs;
  let webhookServer;
  let port;

  beforeEach(async () => {
    jobs = new Map();
    // Use port 0 to get a random available port
    webhookServer = createWebhookServer({ jobs, port: 0 });
    await new Promise((resolve, reject) => {
      webhookServer.server.listen(0, () => {
        port = webhookServer.server.address().port;
        resolve();
      });
      webhookServer.server.on('error', reject);
    });
  });

  afterEach(async () => {
    await new Promise(resolve => webhookServer.server.close(resolve));
  });

  describe('GET /health', () => {
    it('should return 200 with health info', async () => {
      const res = await get(port, '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'healthy');
      assert.strictEqual(res.body.jobs, 0);
      assert.ok(typeof res.body.uptime === 'number');
    });

    it('should reflect job count', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await get(port, '/health');
      assert.strictEqual(res.body.jobs, 1);
    });
  });

  describe('POST /webhooks/logs', () => {
    it('should return 401 without auth token', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'secret' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/logs', { jobId: job.jobId, text: 'hello' });
      assert.strictEqual(res.status, 401);
    });

    it('should return 401 with wrong token', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'secret' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/logs', { jobId: job.jobId, text: 'hello' }, 'wrong-token');
      assert.strictEqual(res.status, 401);
    });

    it('should return 401 for unknown jobId', async () => {
      const res = await post(port, '/webhooks/logs', { jobId: 'nonexistent', text: 'hello' }, 'tok');
      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for missing fields', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/logs', { jobId: job.jobId }, 'tok');
      assert.strictEqual(res.status, 400);
    });

    it('should accept valid log and append to job', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'secret-123' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/logs', { jobId: job.jobId, text: 'output line' }, 'secret-123');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(job.logs.length, 1);
      assert.strictEqual(job.logs[0].message, 'output line');
    });

    it('should fire onMessage callback', async () => {
      let receivedText = null;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onMessage: async (text) => { receivedText = text; }
      });
      jobs.set(job.jobId, job);
      await post(port, '/webhooks/logs', { jobId: job.jobId, text: 'streamed output' }, 'tok');
      assert.strictEqual(receivedText, 'streamed output');
    });
  });

  describe('POST /webhooks/status', () => {
    it('should return 401 without valid auth', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/status', { jobId: job.jobId, status: 'completed' });
      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for missing fields', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/status', { jobId: job.jobId }, 'tok');
      assert.strictEqual(res.status, 400);
    });

    it('should mark job as completed', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      job.start('machine-1');
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/status', { jobId: job.jobId, status: 'completed', exitCode: 0 }, 'tok');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(job.status, JobStatus.COMPLETED);
      assert.strictEqual(job.exitCode, 0);
    });

    it('should mark job as failed with error', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      job.start('machine-1');
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/status', {
        jobId: job.jobId, status: 'failed', exitCode: 1, error: 'agent crashed'
      }, 'tok');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(job.status, JobStatus.FAILED);
      assert.strictEqual(job.error, 'agent crashed');
      assert.strictEqual(job.exitCode, 1);
    });

    it('should update lastActivityAt for running status', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      job.start('machine-1');
      const before = new Date(job.lastActivityAt);
      jobs.set(job.jobId, job);
      await post(port, '/webhooks/status', { jobId: job.jobId, status: 'running' }, 'tok');
      assert.ok(job.lastActivityAt >= before);
      assert.strictEqual(job.status, JobStatus.RUNNING); // unchanged
    });

    it('should fire onComplete callback on completed', async () => {
      let completedJob = null;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async (j) => { completedJob = j; }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);
      await post(port, '/webhooks/status', { jobId: job.jobId, status: 'completed', exitCode: 0 }, 'tok');
      assert.ok(completedJob);
      assert.strictEqual(completedJob.jobId, job.jobId);
      assert.strictEqual(completedJob.status, JobStatus.COMPLETED);
    });

    it('should fire onComplete callback on failed', async () => {
      let completedJob = null;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async (j) => { completedJob = j; }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);
      await post(port, '/webhooks/status', { jobId: job.jobId, status: 'failed', error: 'boom' }, 'tok');
      assert.ok(completedJob);
      assert.strictEqual(completedJob.status, JobStatus.FAILED);
    });
  });

  describe('POST /webhooks/artifacts', () => {
    it('should return 401 without valid auth', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/artifacts', {
        jobId: job.jobId, artifacts: [{ name: 'PR', url: 'http://example.com' }]
      });
      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for missing artifacts array', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/artifacts', { jobId: job.jobId }, 'tok');
      assert.strictEqual(res.status, 400);
    });

    it('should store valid artifacts on the job', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      const res = await post(port, '/webhooks/artifacts', {
        jobId: job.jobId,
        artifacts: [
          { name: 'Pull Request', url: 'https://github.com/owner/repo/pull/1', type: 'pr' },
          { name: 'Test Log', url: 'https://example.com/logs/123', type: 'log' }
        ]
      }, 'tok');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.count, 2);
      assert.strictEqual(job.artifacts.length, 2);
      assert.strictEqual(job.artifacts[0].name, 'Pull Request');
      assert.strictEqual(job.artifacts[1].name, 'Test Log');
    });

    it('should skip artifacts missing name or url', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);
      await post(port, '/webhooks/artifacts', {
        jobId: job.jobId,
        artifacts: [
          { name: 'good', url: 'http://example.com' },
          { name: 'bad-no-url' },
          { url: 'http://bad-no-name.com' }
        ]
      }, 'tok');
      assert.strictEqual(job.artifacts.length, 1);
      assert.strictEqual(job.artifacts[0].name, 'good');
    });
  });

  describe('404 for unknown routes', () => {
    it('should return 404 for unknown path', async () => {
      const res = await post(port, '/unknown', {});
      assert.strictEqual(res.status, 404);
    });
  });

  // ===========================================================
  // Webhook body size limits
  // ===========================================================
  describe('body size limits', () => {
    /**
     * Send raw data (not necessarily valid JSON) to test body size enforcement.
     * Uses a raw HTTP request to bypass the JSON serialization in the
     * normal `post` helper, allowing us to send oversized payloads.
     */
    function postRaw(port, path, rawBody, token) {
      return new Promise((resolve, reject) => {
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody)
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path,
          method: 'POST',
          headers
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            let body;
            try {
              body = data ? JSON.parse(data) : {};
            } catch {
              body = { raw: data };
            }
            resolve({ status: res.statusCode, body });
          });
        });
        req.on('error', reject);
        req.write(rawBody);
        req.end();
      });
    }

    it('should reject bodies larger than the size limit with 413', async () => {
      // Create a payload that exceeds a reasonable body size limit.
      // The fix should enforce a limit (e.g. 1MB). We'll try 2MB.
      const oversizedText = 'x'.repeat(2 * 1024 * 1024);
      const oversizedBody = JSON.stringify({ jobId: 'fake', text: oversizedText });

      const res = await postRaw(port, '/webhooks/logs', oversizedBody, 'tok');
      assert.strictEqual(res.status, 413, `Expected 413 Payload Too Large for oversized body, got ${res.status}`);
    });

    it('should accept normal-sized bodies', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);

      const normalBody = JSON.stringify({ jobId: job.jobId, text: 'normal message' });
      const res = await postRaw(port, '/webhooks/logs', normalBody, 'tok');
      assert.strictEqual(res.status, 200);
    });

    it('should accept a body exactly at a reasonable size', async () => {
      const job = new Job({ repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok' });
      jobs.set(job.jobId, job);

      // Create text that is large but under a typical 1MB limit
      // (accounting for the JSON envelope overhead)
      const text = 'a'.repeat(500 * 1024); // 500KB
      const body = JSON.stringify({ jobId: job.jobId, text });
      const res = await postRaw(port, '/webhooks/logs', body, 'tok');
      assert.strictEqual(res.status, 200);
    });
  });

  // ===========================================================
  // Job cleanup: jobs removed from Map after terminal status
  // ===========================================================
  describe('job cleanup after webhook status', () => {
    it('should fire onComplete on completed status and remove job from map', async () => {
      let completedJobId = null;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async (j) => { completedJobId = j.jobId; }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);

      await post(port, '/webhooks/status', {
        jobId: job.jobId, status: 'completed', exitCode: 0
      }, 'tok');

      assert.strictEqual(completedJobId, job.jobId);
      assert.strictEqual(job.status, JobStatus.COMPLETED);
      assert.strictEqual(jobs.has(job.jobId), false, 'Completed job should be removed from map');
    });

    it('should fire onComplete on failed status and remove job from map', async () => {
      let completedJobId = null;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async (j) => { completedJobId = j.jobId; }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);

      await post(port, '/webhooks/status', {
        jobId: job.jobId, status: 'failed', exitCode: 1, error: 'boom'
      }, 'tok');

      assert.strictEqual(completedJobId, job.jobId);
      assert.strictEqual(job.status, JobStatus.FAILED);
      assert.strictEqual(jobs.has(job.jobId), false, 'Failed job should be removed from map');
    });

    it('should not fire onComplete for running status update', async () => {
      let onCompleteCalled = false;
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async () => { onCompleteCalled = true; }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);

      await post(port, '/webhooks/status', {
        jobId: job.jobId, status: 'running'
      }, 'tok');

      assert.strictEqual(onCompleteCalled, false,
        'onComplete should not fire for running status');
      assert.strictEqual(job.status, JobStatus.RUNNING);
    });

    it('should handle onComplete errors without crashing', async () => {
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onComplete: async () => { throw new Error('callback exploded'); }
      });
      job.start('machine-1');
      jobs.set(job.jobId, job);

      // This should not throw — the webhook server should catch onComplete errors
      const res = await post(port, '/webhooks/status', {
        jobId: job.jobId, status: 'completed', exitCode: 0
      }, 'tok');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(job.status, JobStatus.COMPLETED);
    });

    it('should handle onMessage errors without crashing', async () => {
      const job = new Job({
        repo: 'r', command: 'c', channelId: 'ch', jobToken: 'tok',
        onMessage: async () => { throw new Error('message callback exploded'); }
      });
      jobs.set(job.jobId, job);

      // This should not throw — the webhook server should catch onMessage errors
      const res = await post(port, '/webhooks/logs', {
        jobId: job.jobId, text: 'some output'
      }, 'tok');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(job.logs.length, 1);
    });
  });
});
