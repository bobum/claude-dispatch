/**
 * Tests for the OpenCode output formatter
 *
 * The formatter extracts clean conversational text from OpenCode CLI output.
 * It auto-detects JSON format (--format json) vs default format.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const FORMATTER = path.join(__dirname, '..', 'sidecar', 'formatters', 'opencode.js');

function runFormatter(input) {
  return execFileSync('node', [FORMATTER], {
    input,
    encoding: 'utf-8',
    timeout: 5000
  }).trim();
}

describe('OpenCode Formatter', () => {
  describe('JSON format (--format json)', () => {
    it('should extract response from clean JSON', () => {
      const input = '{"response": "The tests all pass."}';
      assert.strictEqual(runFormatter(input), 'The tests all pass.');
    });

    it('should extract response from JSON with log lines before it', () => {
      const input = [
        '[info] Loading config...',
        'Some log output',
        '{"response": "Here is the result."}'
      ].join('\n');
      assert.strictEqual(runFormatter(input), 'Here is the result.');
    });

    it('should handle multiline response text', () => {
      const response = 'Line one.\\nLine two.\\nLine three.';
      const input = `{"response": "${response}"}`;
      const result = runFormatter(input);
      assert.ok(result.includes('Line one.'));
      assert.ok(result.includes('Line three.'));
    });

    it('should handle empty response field gracefully', () => {
      const input = '{"response": ""}';
      // Empty string is falsy — falls through to default filter which
      // passes the raw JSON through as-is
      const result = runFormatter(input);
      assert.strictEqual(result, '{"response": ""}');
    });

    it('should ignore JSON without response field', () => {
      const input = '{"status": "ok", "code": 0}';
      // No response field — falls through to default filter
      const result = runFormatter(input);
      assert.ok(typeof result === 'string');
    });
  });

  describe('Default format (heuristic filtering)', () => {
    it('should pass through plain conversational text', () => {
      const input = 'The repository contains a Node.js web application.';
      assert.strictEqual(runFormatter(input), input);
    });

    it('should strip model/build markers', () => {
      const input = [
        '> build · gemini-3-pro-preview',
        'Here is the actual response.'
      ].join('\n');
      assert.strictEqual(runFormatter(input), 'Here is the actual response.');
    });

    it('should strip tool call markers', () => {
      const input = [
        '→ Read file src/index.js',
        '→ Write file src/output.js',
        'I have updated the files.'
      ].join('\n');
      assert.strictEqual(runFormatter(input), 'I have updated the files.');
    });

    it('should strip shell command lines', () => {
      const input = [
        '$ ls -F',
        '  src/',
        '  package.json',
        'The project has the following structure.'
      ].join('\n');
      // The `$ ` line is stripped; indented output is treated as tool block
      // and stripped; the final non-indented line passes through
      assert.strictEqual(runFormatter(input), 'The project has the following structure.');
    });

    it('should strip internal log lines', () => {
      const input = [
        '[workspace-setup] Loading...',
        '[config] Done.',
        'Everything is ready.'
      ].join('\n');
      assert.strictEqual(runFormatter(input), 'Everything is ready.');
    });

    it('should strip metadata lines (Tokens, Duration, Cost)', () => {
      const input = [
        'Task completed successfully.',
        'Tokens: 1234',
        'Duration: 5.2s',
        'Cost: $0.01'
      ].join('\n');
      assert.strictEqual(runFormatter(input), 'Task completed successfully.');
    });

    it('should handle empty input', () => {
      const result = execFileSync('node', [FORMATTER], {
        input: '',
        encoding: 'utf-8',
        timeout: 5000
      });
      assert.strictEqual(result.trim(), '');
    });

    it('should preserve multi-paragraph conversational text', () => {
      const input = [
        'First paragraph of the response.',
        '',
        'Second paragraph with more details.',
        '',
        'Final paragraph.'
      ].join('\n');
      const result = runFormatter(input);
      assert.ok(result.includes('First paragraph'));
      assert.ok(result.includes('Second paragraph'));
      assert.ok(result.includes('Final paragraph'));
    });
  });
});
