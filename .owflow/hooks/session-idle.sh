#!/usr/bin/env bash
set -euo pipefail

SOURCE_PATHS=(src scripts package.json tsconfig.json bunfig.toml bun.lock bun.lockb)

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0

changes="$(git status --porcelain=v1 --untracked-files=all -- "${SOURCE_PATHS[@]}" 2>/dev/null)" || exit 0
[ -n "$changes" ] || exit 0

exec bun run build
