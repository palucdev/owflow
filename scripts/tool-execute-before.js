#!/usr/bin/env bun
/**
 * scripts/tool-execute-before.js
 *
 * Pre-execution guard hook for OpenCode tools (tool.execute.before).
 *
 * Primary responsibility:
 * Protect `eslint.config.mjs` from being modified, truncated, or deleted by
 * autonomous tools (edit, write, bash commands, etc.).
 *
 * Contract:
 * - Reads tool invocation payload as JSON from process.argv[2] or stdin.
 * - If the tool call targets `eslint.config.mjs` for modification:
 *     Outputs JSON: { "decision": "block", "reason": "..." }
 *     Exits with status code 1.
 * - Otherwise:
 *     Outputs JSON: { "decision": "approve" }
 *     Exits with status code 0.
 */

import path from 'node:path';
import fs from 'node:fs';

/** The configuration filename that must not be altered by agent tools */
const FORBIDDEN_FILE_NAME = 'eslint.config.mjs';

/** The blocking reason returned to the agent when modification is attempted */
const FORBIDDEN_REASON =
  'Modifying eslint.config.mjs is forbidden.\n\n' +
  'If you believe a rule makes your task impossible,\n' +
  'report this to the user and explain why.';

/**
 * Regex matching destructive bash commands or output redirections targeting eslint.config.mjs.
 * Matches:
 * - File removal or alteration commands (rm, mv, cp, truncate, in-place sed, tee)
 * - Redirection operators writing to the config file (> or >>)
 * - Piping combinations targeting the config file
 */
const BASH_MODIFYING_PATTERN =
  /(?:rm|mv|cp|truncate|sed\s+-i|>\s*|>>\s*|tee\s+).*eslint\.config\.mjs|eslint\.config\.mjs.*(?:>|>>|\|)/i;

/**
 * Approves tool execution and terminates process cleanly.
 */
function approve() {
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

/**
 * Blocks tool execution with a descriptive reason and terminates with exit code 1.
 * @param {string} reason
 */
function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(1);
}

/**
 * Retrieves the raw JSON input from process.argv[2] or stdin.
 * @returns {string}
 */
function getRawInput() {
  if (process.argv[2] && process.argv[2].trim().length > 0) {
    return process.argv[2];
  }

  // Fallback: read from stdin if provided via pipe
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Safely parses the input JSON payload.
 * @param {string} raw
 * @returns {object|null}
 */
function parsePayload(raw) {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolves the target file path across diverse argument formats.
 * @param {object} data
 * @param {object} args
 * @returns {string}
 */
function extractTargetFilePath(data, args) {
  const candidate =
    args.filePath ||
    args.file_path ||
    args.file ||
    args.path ||
    data.filePath ||
    data.file_path ||
    data.file ||
    data.path;

  return typeof candidate === 'string' ? candidate : '';
}

function main() {
  const raw = getRawInput();
  const data = parsePayload(raw);

  // If payload is empty or invalid JSON, allow execution to proceed safely
  if (!data) {
    approve();
  }

  const tool = data.tool || data.context?.tool;

  // Read-only tools are always permitted (e.g. inspecting eslint.config.mjs)
  if (tool === 'read') {
    approve();
  }

  const args = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;
  const command = args.command || data.context?.command || '';

  // Check 1: Detect shell commands attempting to delete or overwrite eslint.config.mjs
  if (tool === 'bash' || command) {
    if (BASH_MODIFYING_PATTERN.test(command)) {
      block(FORBIDDEN_REASON);
    }
  }

  // Check 2: Detect file modification tools (write, edit, etc.) targeting eslint.config.mjs
  const targetFile = extractTargetFilePath(data, args);
  if (targetFile) {
    const baseName = path.basename(targetFile);
    if (baseName === FORBIDDEN_FILE_NAME) {
      block(FORBIDDEN_REASON);
    }
  }

  // All safety checks passed; approve tool execution
  approve();
}

main();
