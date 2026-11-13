#!/usr/bin/env bash
set -euo pipefail

ARG_FILE="${1:-}"
input=""

if [ -t 0 ]; then
  input=""
else
  input=$(cat || true)
fi

bun -e "
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argFile = process.argv[1];
const rawInput = process.argv[2];

let data = {};
if (rawInput && rawInput.trim().length > 0) {
  try {
    data = JSON.parse(rawInput);
  } catch {}
}

const sessionID =
  data.session?.sessionID ||
  data.context?.sessionID ||
  data.sessionID ||
  process.env.OPENCODE_SESSION_ID ||
  'default';

const cleanSessionID = String(sessionID).replace(/[^a-zA-Z0-9_-]/g, '_');
const statePath = \`/tmp/owflow-lint-state-\${cleanSessionID}.json\`;

const args = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;

let targetFile = argFile;
if (!targetFile || targetFile.trim().length === 0) {
  targetFile =
    args.filePath ||
    args.file_path ||
    args.file ||
    args.path ||
    data.filePath ||
    data.file_path ||
    data.file ||
    data.path ||
    '';
}

if (!targetFile || typeof targetFile !== 'string') {
  process.exit(0);
}

const canonicalPath = path.resolve(process.cwd(), targetFile);

if (!fs.existsSync(canonicalPath)) {
  process.exit(0);
}

const ext = path.extname(canonicalPath).toLowerCase();
if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
  process.exit(0);
}

if (
  canonicalPath.includes('/node_modules/') ||
  canonicalPath.includes('/dist/') ||
  canonicalPath.includes('/.owflow/') ||
  canonicalPath.includes('/.git/')
) {
  process.exit(0);
}

let state = {};
if (fs.existsSync(statePath)) {
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {}
}

const repoRoot = process.cwd();
const configPath = path.resolve(repoRoot, 'eslint.config.mjs');
const eslintArgs = fs.existsSync(configPath)
  ? ['x', 'eslint', '-c', configPath, canonicalPath]
  : ['x', 'eslint', canonicalPath];

const eslintProc = spawnSync('bun', eslintArgs, {
  encoding: 'utf8',
  cwd: repoRoot,
});

if (eslintProc.status === 0) {
  if (state[canonicalPath]) {
    delete state[canonicalPath];
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch {}
  }
  process.exit(0);
}

const attempt = (state[canonicalPath] || 0) + 1;
state[canonicalPath] = attempt;
try {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
} catch {}

const lintOutput = ((eslintProc.stdout || '') + '\n' + (eslintProc.stderr || '')).trim();

if (attempt < 3) {
  console.log(\`Linting failed. Please fix these errors:\n\${lintOutput}\`);
  process.exit(0);
} else {
  console.error('CRITICAL: File has failed linting 3 times. STOP. Report to user.');
  process.exit(1);
}
" "$ARG_FILE" "$input"
