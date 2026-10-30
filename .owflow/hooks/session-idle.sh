#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0

if git diff --quiet HEAD -- src ':!src/__tests__' package.json README.md LICENSE; then
  exit 0
fi

bun run type-check
bun run build
