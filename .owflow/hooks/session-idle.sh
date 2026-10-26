#!/usr/bin/env bash
set -u

SOURCE_PATHS=(src scripts package.json tsconfig.json bunfig.toml bun.lock bun.lockb)

cat >/dev/null

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0

changes="$(git status --porcelain=v1 --untracked-files=all -- "${SOURCE_PATHS[@]}" 2>/dev/null)" || exit 0
[ -n "$changes" ] || exit 0

bun_bin="$(command -v bun 2>/dev/null)" || { printf '[owflow] build-hook: bun is not on PATH\n' >&2; exit 1; }

if output="$("$bun_bin" run build 2>&1)"; then
  printf '{"protocol":"owflow-hooks/1","status":"ok"}\n'
else
  status=$?
  printf '%s\n' "$output" | tail -n 40 >&2
  printf '{"protocol":"owflow-hooks/1","status":"failed","reason":"bun run build failed (exit %s)"}\n' "$status"
fi
