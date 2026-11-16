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
 *     Attempts 1 & 2: Outputs JSON block decision with attempt count and hint, exits 1.
 *     Attempt >= 3:   Outputs JSON block decision with CRITICAL halting message and hint, exits 1.
 * - Otherwise:
 *     Outputs JSON: { "decision": "approve" }
 *     Clears any previous attempt count and exits 0.
 */

import path from 'node:path';
import fs from 'node:fs';

/** The configuration filename that must not be altered by agent tools */
const FORBIDDEN_FILE_NAME = 'eslint.config.mjs';

/** Maximum number of failed guard attempts permitted before critical escalation */
const MAX_ATTEMPTS = 3;

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
 * Extracts and sanitizes the session ID to create an isolated state file path.
 * @param {object} data
 * @returns {string} Absolute path to session state file in /tmp
 */
function resolveStatePath(data) {
  const sessionID =
    data?.session?.sessionID ||
    data?.context?.sessionID ||
    data?.sessionID ||
    process.env.OPENCODE_SESSION_ID ||
    'default';

  const cleanSessionID = String(sessionID).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `/tmp/owflow-guard-state-${cleanSessionID}.json`;
}

/**
 * Safely loads the persistent guard attempt state for this session.
 * @param {string} statePath
 * @returns {Record<string, number>}
 */
function loadState(statePath) {
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Safely persists the updated retry state for this session.
 * @param {string} statePath
 * @param {Record<string, number>} state
 */
function saveState(statePath, state) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    // Non-fatal
  }
}

/**
 * Approves tool execution, clears recorded attempts, and terminates process cleanly.
 * @param {string} [statePath]
 */
function approve(statePath) {
  if (statePath) {
    const state = loadState(statePath);
    if (state.forbidden_file_attempts) {
      delete state.forbidden_file_attempts;
      saveState(statePath, state);
    }
  }
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

/**
 * Blocks tool execution with escalation attempts and terminates with exit code 1.
 * @param {string} statePath
 */
function block(statePath) {
  const state = loadState(statePath);
  const attempt = (state.forbidden_file_attempts || 0) + 1;
  state.forbidden_file_attempts = attempt;
  saveState(statePath, state);

  let reason;
  if (attempt < MAX_ATTEMPTS) {
    reason = `Modifying eslint.config.mjs is forbidden (attempt ${attempt}/${MAX_ATTEMPTS}). Hint: If you believe a rule makes your task impossible, report this to the user and explain why.`;
  } else {
    reason = `CRITICAL: Attempted to modify eslint.config.mjs 3 times. Stopping conversation. Hint: Editing eslint.config.mjs is strictly prohibited. Ask the user for manual intervention.`;
  }

  console.log(
    JSON.stringify({
      decision: 'block',
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      reason,
    }),
  );
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

  const statePath = resolveStatePath(data);
  const tool = data.tool || data.context?.tool;

  // Read-only tools are always permitted (e.g. inspecting eslint.config.mjs)
  if (tool === 'read') {
    approve(statePath);
  }

  const args = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;
  const command = args.command || data.context?.command || '';

  // Check 1: Detect shell commands attempting to delete or overwrite eslint.config.mjs
  if (tool === 'bash' || command) {
    if (BASH_MODIFYING_PATTERN.test(command)) {
      block(statePath);
    }
  }

  // Check 2: Detect file modification tools (write, edit, etc.) targeting eslint.config.mjs
  const targetFile = extractTargetFilePath(data, args);
  if (targetFile) {
    const baseName = path.basename(targetFile);
    if (baseName === FORBIDDEN_FILE_NAME) {
      block(statePath);
    }
  }

  // All safety checks passed; approve tool execution
  approve(statePath);
}

main();
