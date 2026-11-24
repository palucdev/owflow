#!/usr/bin/env bun
// Post-execution hook (tool.execute.after): lints a modified source file with
// ESLint via a 3-attempt feedback loop. Attempts 1-2 print the report and exit
// 0; attempt 3 reports CRITICAL and exits 1 for human intervention. Retry
// counts per session live in /tmp/owflow-lint-state-<session>.json.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 3;
const DEFAULT_SESSION_ID = 'default';
const CRITICAL_ATTEMPT_MESSAGE = 'CRITICAL: File has failed linting 3 times. STOP. Report to user.';
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_PATH_SEGMENTS = ['/node_modules/', '/dist/', '/.owflow/', '/.git/', '/scripts/'];

const resolveSessionId = (data) => {
  const sessionId = data.session?.sessionID || data.context?.sessionID || data.sessionID || DEFAULT_SESSION_ID;
  return String(sessionId).replaceAll(/[^a-zA-Z0-9_-]/g, '_');
};

const resolveStatePath = (data) => `/tmp/owflow-lint-state-${resolveSessionId(data)}.json`;

const loadState = (statePath) => {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
};

const saveState = (statePath, state) => {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch {
    // Non-fatal: lost state only weakens the retry counter.
  }
};

const parseInputData = (raw) => {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const resolveInvocation = () => {
  // argv[2] is the target file and argv[3] the raw JSON payload; a JSON-shaped
  // argv[2] means the hook was invoked without a target file.
  let argumentFile = process.argv[2] || '';
  let rawInput = process.argv[3] || '';
  if (argumentFile.trimStart().startsWith('{')) {
    rawInput = argumentFile;
    argumentFile = '';
  }
  if (rawInput === '' && !process.stdin.isTTY) {
    try {
      rawInput = fs.readFileSync(0, 'utf8');
    } catch {
      // No piped payload available.
    }
  }
  return { argumentFile: argumentFile.trim(), rawInput };
};

const resolveTargetFile = (argumentFile, data) => {
  if (argumentFile !== '') {
    return argumentFile;
  }
  const toolArguments = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;
  const candidate = [
    toolArguments.filePath,
    toolArguments.file_path,
    toolArguments.file,
    toolArguments.path,
    data.filePath,
    data.file_path,
    data.file,
    data.path,
  ].find((value) => typeof value === 'string');
  return typeof candidate === 'string' ? candidate.trim() : '';
};

const isEligibleSourceFile = (canonicalPath) => {
  const extension = path.extname(canonicalPath).toLowerCase();
  return fs.existsSync(canonicalPath) && SUPPORTED_EXTENSIONS.has(extension) && IGNORED_PATH_SEGMENTS.every((segment) => !canonicalPath.includes(segment));
};

const runEslintOnFile = (repositoryRoot, canonicalPath) => {
  const configPath = path.resolve(repositoryRoot, 'eslint.config.mjs');
  const eslintArguments = fs.existsSync(configPath) ? ['x', 'eslint', '-c', configPath, canonicalPath] : ['x', 'eslint', canonicalPath];
  const result = spawnSync(process.execPath, eslintArguments, { encoding: 'utf8', cwd: repositoryRoot });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return { status: result.status, output };
};

const clearFailureAttempt = ({ statePath, state, canonicalPath }) => {
  if (!Object.hasOwn(state, canonicalPath)) {
    return;
  }
  delete state[canonicalPath];
  saveState(statePath, state);
};

const handleLintResult = (lintContext, eslintResult) => {
  if (eslintResult.status === 0) {
    clearFailureAttempt(lintContext);
    process.exit(0);
  }
  const attempt = (lintContext.state[lintContext.canonicalPath] || 0) + 1;
  saveState(lintContext.statePath, { ...lintContext.state, [lintContext.canonicalPath]: attempt });
  if (attempt < MAX_ATTEMPTS) {
    console.log(`Linting failed. Please fix these errors:\n${eslintResult.output}`);
    process.exit(0);
  }
  console.error(CRITICAL_ATTEMPT_MESSAGE);
  process.exit(1);
};

const main = () => {
  const { argumentFile, rawInput } = resolveInvocation();
  const data = parseInputData(rawInput);
  const targetFile = resolveTargetFile(argumentFile, data);
  if (targetFile === '') {
    process.exit(0);
  }
  const canonicalPath = path.resolve(process.cwd(), targetFile);
  if (!isEligibleSourceFile(canonicalPath)) {
    process.exit(0);
  }
  const statePath = resolveStatePath(data);
  const lintContext = { statePath, state: loadState(statePath), canonicalPath };
  handleLintResult(lintContext, runEslintOnFile(process.cwd(), canonicalPath));
};

main();
