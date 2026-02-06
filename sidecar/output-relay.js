#!/usr/bin/env node
/**
 * output-relay.js — Open-Dispatch Sidecar Output Relay
 *
 * Reads agent stdout line-by-line, buffers output, and POSTs chunks
 * to Open-Dispatch's /webhooks/logs endpoint over Fly.io 6PN.
 *
 * Buffering: Accumulates text for up to 500ms or 20 lines (whichever
 * comes first), then POSTs a single chunk. This avoids flooding
 * Open-Dispatch with per-line HTTP requests.
 *
 * Usage (piped from agent):
 *   claude --output-format stream-json -p "task" | node output-relay.js
 *
 * Required env vars:
 *   JOB_ID            — Job identifier
 *   JOB_TOKEN         — Auth token for webhook
 *   OPEN_DISPATCH_URL — Webhook base URL
 */

'use strict';

const { createInterface } = require('readline');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JOB_ID = process.env.JOB_ID;
const JOB_TOKEN = process.env.JOB_TOKEN;
const OPEN_DISPATCH_URL = process.env.OPEN_DISPATCH_URL;
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFER_LINES = 20;

if (!JOB_ID || !JOB_TOKEN || !OPEN_DISPATCH_URL) {
  console.error('[output-relay] Missing required env vars');
  process.exit(1);
}

const webhookUrl = new URL('/webhooks/logs', OPEN_DISPATCH_URL);
const transport = webhookUrl.protocol === 'https:' ? https : http;

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

let buffer = [];
let flushTimer = null;

function scheduleFlush() {
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (buffer.length === 0) return;

  const text = buffer.join('\n');
  buffer = [];

  postLog(text);
}

// ---------------------------------------------------------------------------
// HTTP POST (fire-and-forget, non-blocking)
// ---------------------------------------------------------------------------

function postLog(text) {
  const payload = JSON.stringify({ jobId: JOB_ID, text });

  const options = {
    hostname: webhookUrl.hostname,
    port: webhookUrl.port || (webhookUrl.protocol === 'https:' ? 443 : 80),
    path: webhookUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JOB_TOKEN}`,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 5000
  };

  const req = transport.request(options, (res) => {
    // Drain response to free socket
    res.resume();
    if (res.statusCode !== 200) {
      console.error(`[output-relay] Webhook returned ${res.statusCode}`);
    }
  });

  req.on('error', (err) => {
    console.error(`[output-relay] POST error: ${err.message}`);
  });

  req.on('timeout', () => {
    req.destroy();
    console.error('[output-relay] POST timed out');
  });

  req.write(payload);
  req.end();
}

// ---------------------------------------------------------------------------
// Read stdin line-by-line
// ---------------------------------------------------------------------------

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  // Pass through to stdout (Fly.io logs capture)
  process.stdout.write(line + '\n');

  buffer.push(line);

  if (buffer.length >= MAX_BUFFER_LINES) {
    flush();
  } else {
    scheduleFlush();
  }
});

rl.on('close', () => {
  // Final flush on stream end
  flush();
});

// Handle signals gracefully
process.on('SIGTERM', () => {
  flush();
  process.exit(0);
});

process.on('SIGINT', () => {
  flush();
  process.exit(0);
});
