#!/usr/bin/env bun
/**
 * scripts/tool-execute-after.js
 *
 * Post-execution verification hook for OpenCode tools (tool.execute.after).
 *
 * Primary responsibility:
 * Automatically executes ESLint against modified JavaScript/TypeScript source files
 * after a tool finishes execution. It implements a 3-attempt feedback and escalation loop:
 *
 * - Attempts 1 & 2: Outputs the ESLint error report to guide the agent to fix violations,
 *                   exiting with status code 0 so the agent can take corrective action.
 * - Attempt >= 3:   Escalates critically by reporting failure and exiting with status code 1,
 *                   halting the automated execution loop for human intervention.
 * - On success:     Clears any recorded failure attempt count for the file in the state file.
 *
 * State persistence:
 * Retry attempt counts are stored per session at `/tmp/owflow-lint-state-${cleanSessionID}.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Maximum number of failed lint attempts permitted before escalating to human */
const MAX_ATTEMPTS = 3;

/** File extensions eligible for automated linting */
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Path segments that should be excluded from automated lint checks */
const IGNORED_PATH_SEGMENTS = [
  '/node_modules/', // Third-party dependencies
  '/dist/', // Built / compiled artifacts
  '/.owflow/', // Workflow engine metadata and hooks
  '/.git/', // Version control internals
  '/scripts/', // Build and operational utility scripts
];

/**
 * Extracts and sanitizes the session ID to create an isolated state file path.
 * @param {object} data
 * @returns {string} Absolute path to session state file in /tmp
 */
function resolveStatePath(data) {
  const sessionID =
    data.session?.sessionID ||
    data.context?.sessionID ||
    data.sessionID ||
    process.env.OPENCODE_SESSION_ID ||
    'default';

  const cleanSessionID = String(sessionID).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `/tmp/owflow-lint-state-${cleanSessionID}.json`;
}

/**
 * Safely loads the persistent retry state for this session.
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
    // Non-fatal: if write fails, state is simply lost across process restarts
  }
}

/**
 * Parses raw JSON string input if present.
 * @param {string} raw
 * @returns {object}
 */
function parseInputData(raw) {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Determines the target file path from CLI arguments or hook payload.
 * @param {string} argFile
 * @param {object} data
 * @returns {string}
 */
function resolveTargetFile(argFile, data) {
  if (argFile && argFile.trim().length > 0) {
    return argFile.trim();
  }

  const args = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;
  const candidate =
    args.filePath ||
    args.file_path ||
    args.file ||
    args.path ||
    data.filePath ||
    data.file_path ||
    data.file ||
    data.path ||
    '';

  return typeof candidate === 'string' ? candidate.trim() : '';
}

/**
 * Validates whether the given canonical file path is an existing, eligible source file.
 * @param {string} canonicalPath
 * @returns {boolean}
 */
function isEligibleSourceFile(canonicalPath) {
  // Ensure the file exists on the filesystem (it may have been deleted by a tool)
  if (!fs.existsSync(canonicalPath)) {
    return false;
  }

  // Check for supported source code extensions
  const ext = path.extname(canonicalPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return false;
  }

  // Ensure file is not in ignored directories
  for (const segment of IGNORED_PATH_SEGMENTS) {
    if (canonicalPath.includes(segment)) {
      return false;
    }
  }

  return true;
}

/**
 * Executes ESLint against a single target file using Bun.
 * @param {string} repoRoot
 * @param {string} targetPath
 * @returns {{ status: number | null, output: string }}
 */
function runEslintOnFile(repoRoot, targetPath) {
  const configPath = path.resolve(repoRoot, 'eslint.config.mjs');
  const eslintArgs = fs.existsSync(configPath)
    ? ['x', 'eslint', '-c', configPath, targetPath]
    : ['x', 'eslint', targetPath];

  const result = spawnSync('bun', eslintArgs, {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  const output = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
  return { status: result.status, output };
}

function main() {
  // Argument resolution:
  // process.argv[2]: optional target file passed directly
  // process.argv[3]: raw JSON payload from stdin
  let argFile = process.argv[2] || '';
  let rawInput = process.argv[3] || '';

  // If argument 2 looks like JSON payload directly (e.g. invoked without argFile)
  if (argFile.trim().startsWith('{')) {
    rawInput = argFile;
    argFile = '';
  }

  // If rawInput was not provided in argv, try reading from stdin (piped input)
  if (!rawInput && !process.stdin.isTTY) {
    try {
      rawInput = fs.readFileSync(0, 'utf8');
    } catch {}
  }

  const data = parseInputData(rawInput);
  const targetFile = resolveTargetFile(argFile, data);

  // If no target file is found or specified, exit cleanly
  if (!targetFile) {
    process.exit(0);
  }

  const canonicalPath = path.resolve(process.cwd(), targetFile);

  // Skip files that do not exist, have wrong extension, or are in ignored directories
  if (!isEligibleSourceFile(canonicalPath)) {
    process.exit(0);
  }

  const statePath = resolveStatePath(data);
  const state = loadState(statePath);
  const repoRoot = process.cwd();

  // Run ESLint on the target file
  const { status, output } = runEslintOnFile(repoRoot, canonicalPath);

  // Case 1: Linting passed cleanly (status 0)
  if (status === 0) {
    if (state[canonicalPath]) {
      delete state[canonicalPath];
      saveState(statePath, state);
    }
    process.exit(0);
  }

  // Case 2: Linting failed (status != 0)
  const attempt = (state[canonicalPath] || 0) + 1;
  state[canonicalPath] = attempt;
  saveState(statePath, state);

  if (attempt < MAX_ATTEMPTS) {
    // Attempts 1 and 2: provide actionable feedback to agent and exit 0
    console.log(
      `[ESLint Verification (Attempt ${attempt}/${MAX_ATTEMPTS})]:\n` +
        `${output}\n\n` +
        `Hint: Fix the linting violations above in ${path.basename(canonicalPath)} to adhere to project standards.`,
    );
    process.exit(0);
  } else {
    // Attempt 3: escalate to human and exit with code 1
    console.error(
      `CRITICAL: File ${path.basename(canonicalPath)} has failed linting 3 times. Halting conversation.\n` +
        `Hint: Persistent lint failures detected. Report errors to the user.`,
    );
    process.exit(1);
  }
}

main();
