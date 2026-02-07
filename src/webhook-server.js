/**
 * Webhook Server
 *
 * HTTP server that receives callbacks from Sprites over the Fly.io private network.
 * Sprites POST agent output, status changes, and artifacts back to Open-Dispatch
 * via these endpoints instead of relying on stdout polling.
 *
 * Runs on port 8080 (separate from chat provider ports).
 */

const http = require('http');

/** Maximum body size: 1 MB */
const MAX_BODY_SIZE = 1 * 1024 * 1024;

/**
 * Create a webhook server.
 * @param {Object} options
 * @param {Map} options.jobs - Map of jobId → Job objects (from sprite-core)
 * @param {number} [options.port] - Listen port (default: 8080)
 * @returns {Object} { server, start(), stop() }
 */
function createWebhookServer({ jobs, port = 8080 }) {
  const server = http.createServer(async (req, res) => {
    // CORS and content type
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/health') {
      return respond(res, 200, {
        status: 'healthy',
        jobs: jobs.size,
        uptime: process.uptime()
      });
    }

    if (req.method === 'POST' && req.url === '/webhooks/logs') {
      return handleLogs(req, res);
    }

    if (req.method === 'POST' && req.url === '/webhooks/status') {
      return handleStatus(req, res);
    }

    if (req.method === 'POST' && req.url === '/webhooks/artifacts') {
      return handleArtifacts(req, res);
    }

    respond(res, 404, { error: 'Not found' });
  });

  /**
   * Parse JSON body from request.
   */
  function parseBody(req) {
    return new Promise((resolve, reject) => {
      // Early rejection based on Content-Length header when present
      const contentLength = parseInt(req.headers['content-length'], 10);
      if (contentLength > MAX_BODY_SIZE) {
        req.resume(); // Drain the request body
        const err = new Error('Body too large');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }

      let data = '';
      let size = 0;
      let rejected = false;
      req.on('data', chunk => {
        if (rejected) return;
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          rejected = true;
          req.resume();
          const err = new Error('Body too large');
          err.code = 'BODY_TOO_LARGE';
          reject(err);
          return;
        }
        data += chunk;
      });
      req.on('end', () => {
        if (rejected) return;
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', (err) => {
        if (rejected) return;
        reject(err);
      });
    });
  }

  /**
   * Validate job token from Authorization header.
   * Returns the Job if valid, or null.
   */
  function authenticateJob(req, jobId) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!jobId || !token) return null;

    const job = jobs.get(jobId);
    if (!job) return null;
    if (job.jobToken !== token) return null;

    return job;
  }

  function respond(res, status, body) {
    res.writeHead(status);
    res.end(JSON.stringify(body));
  }

  /**
   * POST /webhooks/logs — real-time agent output
   * Body: { jobId, text }
   */
  async function handleLogs(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      if (e.code === 'BODY_TOO_LARGE') {
        return respond(res, 413, { error: 'Payload too large' });
      }
      return respond(res, 400, { error: 'Invalid JSON' });
    }

    const { jobId, text } = body;
    if (!jobId || !text) {
      return respond(res, 400, { error: 'Missing jobId or text' });
    }

    const job = authenticateJob(req, jobId);
    if (!job) {
      return respond(res, 401, { error: 'Unauthorized' });
    }

    job.addLog(text);

    // Fire the onMessage callback (streams to chat)
    if (job.onMessage) {
      try {
        await job.onMessage(text);
      } catch (e) {
        console.error(`[Webhook] onMessage error for job ${jobId}:`, e.message);
      }
    }

    respond(res, 200, { ok: true });
  }

  /**
   * POST /webhooks/status — job state transitions
   * Body: { jobId, status, exitCode, error }
   */
  async function handleStatus(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      if (e.code === 'BODY_TOO_LARGE') {
        return respond(res, 413, { error: 'Payload too large' });
      }
      return respond(res, 400, { error: 'Invalid JSON' });
    }

    const { jobId, status, exitCode, error } = body;
    if (!jobId || !status) {
      return respond(res, 400, { error: 'Missing jobId or status' });
    }

    const job = authenticateJob(req, jobId);
    if (!job) {
      return respond(res, 401, { error: 'Unauthorized' });
    }

    if (status === 'completed') {
      job.complete(exitCode || 0);
    } else if (status === 'failed') {
      job.fail(error || 'Sprite reported failure', exitCode || 1);
    } else if (status === 'running') {
      // Already running, just update activity
      job.lastActivityAt = new Date();
    }

    // Fire the onComplete callback (resolves the sendToInstance Promise)
    if (job.onComplete && (status === 'completed' || status === 'failed')) {
      try {
        await job.onComplete(job);
      } catch (e) {
        console.error(`[Webhook] onComplete error for job ${jobId}:`, e.message);
      }
    }

    // Clean up completed/failed jobs from the map to prevent memory leaks
    if (status === 'completed' || status === 'failed') {
      jobs.delete(jobId);
    }

    respond(res, 200, { ok: true });
  }

  /**
   * POST /webhooks/artifacts — PR URLs, screenshots, test logs
   * Body: { jobId, artifacts: [{ name, url, type }] }
   */
  async function handleArtifacts(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      if (e.code === 'BODY_TOO_LARGE') {
        return respond(res, 413, { error: 'Payload too large' });
      }
      return respond(res, 400, { error: 'Invalid JSON' });
    }

    const { jobId, artifacts } = body;
    if (!jobId || !Array.isArray(artifacts)) {
      return respond(res, 400, { error: 'Missing jobId or artifacts array' });
    }

    const job = authenticateJob(req, jobId);
    if (!job) {
      return respond(res, 401, { error: 'Unauthorized' });
    }

    for (const artifact of artifacts) {
      if (artifact.name && artifact.url) {
        job.addArtifact(artifact);
      }
    }

    respond(res, 200, { ok: true, count: artifacts.length });
  }

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        server.listen(port, () => {
          console.log(`[Webhook] Server listening on port ${port}`);
          resolve();
        });
        server.on('error', reject);
      });
    },
    stop() {
      return new Promise((resolve) => {
        server.close(resolve);
      });
    }
  };
}

module.exports = { createWebhookServer };
