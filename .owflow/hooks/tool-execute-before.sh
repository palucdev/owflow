#!/usr/bin/env bash
set -euo pipefail

# Read stdin input from the OpenCode tool execution hook
input=$(cat)

if [ -z "$input" ]; then
  echo '{"decision": "approve"}'
  exit 0
fi

# Locate the companion guard script in /scripts relative to the repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/tool-execute-before.js"

# Execute the guard script using Bun and capture its output
OUTPUT=$(bun "$SCRIPT_PATH" "$input" 2>&1) || {
  echo "$OUTPUT"
  exit 1
}

echo "$OUTPUT"
exit 0
