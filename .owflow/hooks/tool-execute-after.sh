#!/usr/bin/env bash
set -euo pipefail

# Optional file path passed as argument $1
ARG_FILE="${1:-}"
input=""

# If stdin is not a terminal, capture the JSON payload passed to the hook
if [ -t 0 ]; then
  input=""
else
  input=$(cat || true)
fi

# Locate the companion lint runner script in /scripts relative to the repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_PATH="$REPO_ROOT/scripts/tool-execute-after.js"

# Execute the lint verification script using Bun
bun "$SCRIPT_PATH" "$ARG_FILE" "$input"
