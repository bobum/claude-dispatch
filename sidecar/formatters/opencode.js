#!/usr/bin/env node
/**
 * OpenCode Output Formatter (Streaming)
 *
 * Filters OpenCode CLI output line-by-line in real time, stripping tool-call
 * markers, model headers, and metadata so only conversational prose reaches
 * the downstream webhook relay.
 *
 * Operates in streaming mode — lines are emitted as they arrive so the
 * output-relay.js can report progress. If a line looks like OpenCode's
 * --format json output ({"response": "..."}), the response text is extracted
 * and emitted instead.
 *
 * Usage:
 *   opencode run -- "task" | node formatters/opencode.js | node output-relay.js
 *
 * Enable by setting OUTPUT_FORMATTER=opencode in your Sprite environment.
 */

'use strict';

const { createInterface } = require('readline');

let inToolBlock = false;
let seenContent = false;

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  // Try JSON extraction: {"response": "..."}
  if (line.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.response) {
        process.stdout.write(parsed.response + '\n');
        return;
      }
    } catch {
      // Not JSON — fall through to heuristic filter
    }
  }

  const trimmed = line.trim();

  // Skip empty lines before any content
  if (!seenContent && !trimmed) return;

  // Skip model/build markers: "> build · gemini-3-pro-preview"
  if (/^>\s+\w+\s+·\s+/.test(trimmed)) return;

  // Skip tool call markers: "→ Read file", "→ Write file"
  if (/^[→⟶➜]\s+/.test(trimmed)) return;

  // Skip shell commands: "$ ls -F"
  if (/^\$\s+/.test(trimmed)) {
    inToolBlock = true;
    return;
  }

  // End tool output block on next non-indented non-empty line
  if (inToolBlock && trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
    inToolBlock = false;
  }
  if (inToolBlock) return;

  // Skip internal log lines: "[workspace-setup] ..."
  if (/^\[[\w-]+\]\s/.test(trimmed)) return;

  // Skip metadata lines
  if (/^Tokens:\s/.test(trimmed)) return;
  if (/^Duration:\s/.test(trimmed)) return;
  if (/^Cost:\s/.test(trimmed)) return;

  seenContent = true;
  process.stdout.write(line + '\n');
});
