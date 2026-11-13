#!/usr/bin/env bash
set -euo pipefail

input=$(cat)

if [ -z "$input" ]; then
  echo '{"decision": "approve"}'
  exit 0
fi

OUTPUT=$(bun -e "
import path from 'node:path';

const raw = process.argv[1];
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

const tool = data.tool || data.context?.tool;
if (tool === 'read') {
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

const args = data.args || data.context?.args || data.tool_input || data.context?.tool_input || data;
const command = args.command || data.context?.command || '';

if (tool === 'bash' || command) {
  const isModifying = /(?:rm|mv|cp|truncate|sed\s+-i|>\s*|>>\s*|tee\s+).*eslint\.config\.mjs|eslint\.config\.mjs.*(?:>|>>|\|)/i;
  if (isModifying.test(command)) {
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'Modifying eslint.config.mjs is forbidden.\n\nIf you believe a rule makes your task impossible,\nreport this to the user and explain why.'
    }));
    process.exit(1);
  }
}

const fileCandidate =
  args.filePath ||
  args.file_path ||
  args.file ||
  args.path ||
  data.filePath ||
  data.file_path ||
  data.file ||
  data.path;

if (typeof fileCandidate === 'string') {
  const base = path.basename(fileCandidate);
  if (base === 'eslint.config.mjs') {
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'Modifying eslint.config.mjs is forbidden.\n\nIf you believe a rule makes your task impossible,\nreport this to the user and explain why.'
    }));
    process.exit(1);
  }
}

console.log(JSON.stringify({ decision: 'approve' }));
process.exit(0);
" "$input" 2>&1) || {
  echo "$OUTPUT"
  exit 1
}

echo "$OUTPUT"
exit 0
