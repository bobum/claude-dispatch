#!/usr/bin/env node
/**
 * OpenCode Output Formatter
 *
 * Transforms OpenCode CLI output into clean conversational text suitable
 * for chat delivery. Auto-detects the input format:
 *
 *   --format json  →  Parses {"response": "..."} and outputs the text
 *   default format →  Strips tool-call markers, keeps agent prose
 *
 * Usage:
 *   # Recommended: use OpenCode's JSON format for reliable extraction
 *   opencode run --format json -- "task" | node formatters/opencode.js
 *
 *   # Also works with default format (best-effort heuristic filtering)
 *   opencode run -- "task" | node formatters/opencode.js
 *
 * Enable by setting OUTPUT_FORMATTER=opencode in your Sprite environment.
 */

'use strict';

const { createInterface } = require('readline');

const lines = [];

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  lines.push(line);
});

rl.on('close', () => {
  const text = lines.join('\n').trim();
  if (!text) process.exit(0);

  // Try JSON format first, fall back to default format filtering
  const response = extractJsonResponse(text) || filterDefaultFormat(text);
  if (response) {
    process.stdout.write(response + '\n');
  }
});

/**
 * Extract the response text from OpenCode's --format json output.
 * Returns null if the input is not valid OpenCode JSON.
 */
function extractJsonResponse(text) {
  // OpenCode wraps the final response as: {"response": "..."}
  // Try parsing the whole output first
  try {
    const parsed = JSON.parse(text);
    if (parsed.response) return parsed.response;
  } catch {
    // Not pure JSON — may have log lines before the JSON object
  }

  // Try to find the last JSON object in the output
  const lastBrace = text.lastIndexOf('\n{');
  if (lastBrace >= 0) {
    try {
      const parsed = JSON.parse(text.slice(lastBrace + 1));
      if (parsed.response) return parsed.response;
    } catch {
      // Not JSON
    }
  }

  return null;
}

/**
 * Filter OpenCode's default formatted output to extract just the
 * agent's conversational response. Strips tool-call markers, model
 * headers, and metadata lines.
 *
 * This is a best-effort heuristic — use --format json for reliable
 * extraction.
 */
function filterDefaultFormat(text) {
  const inputLines = text.split('\n');
  const filtered = [];
  let inToolBlock = false;

  for (const line of inputLines) {
    const trimmed = line.trim();

    // Skip empty lines at the start
    if (filtered.length === 0 && !trimmed) continue;

    // Skip model/build markers: "> build · gemini-3-pro-preview"
    if (/^>\s+\w+\s+·\s+/.test(trimmed)) continue;

    // Skip tool call markers: "→ Read file", "→ Write file"
    if (/^[→⟶➜]\s+/.test(trimmed)) continue;

    // Skip shell commands: "$ ls -F"
    if (/^\$\s+/.test(trimmed)) {
      inToolBlock = true;
      continue;
    }

    // End tool output block on next non-indented non-empty line
    if (inToolBlock && trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
      inToolBlock = false;
    }
    if (inToolBlock) continue;

    // Skip internal log lines: "[workspace-setup] ..."
    if (/^\[[\w-]+\]\s/.test(trimmed)) continue;

    // Skip metadata lines
    if (/^Tokens:\s/.test(trimmed)) continue;
    if (/^Duration:\s/.test(trimmed)) continue;
    if (/^Cost:\s/.test(trimmed)) continue;

    filtered.push(line);
  }

  // Trim trailing empty lines
  while (filtered.length > 0 && !filtered[filtered.length - 1].trim()) {
    filtered.pop();
  }

  return filtered.join('\n').trim();
}
