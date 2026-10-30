# User Hooks

## Overview

owflow exposes OpenCode's lifecycle events to the host project as git-style script hooks. Every regular file in `<project>/.owflow/hooks/` is validated at plugin initialization and dispatched through owflow's hook handlers — first the built-in destructive-command guard, then the project's scripts. All discovery, execution, reporting, status, and log logic lives in a single module (`src/hooks/user-hooks.ts`), with `src/cli/show-hooks.ts` (CLI) and `src/tui.ts` (TUI) providing the standalone surfaces.

## Discovery and Naming

- One directory level only: `.owflow/hooks/` (no recursion). A missing or empty directory is a valid no-op.
- The filename stem must be lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and maps mechanically to a dotted event name: `tool-execute-before.sh` → `tool.execute.before`.
- A stem may also name a v1 **host event** (`HOST_EVENT_NAMES`, 32 events), firing when the single `event` hook receives that type (`session-idle.sh` → `session.idle`).
- Each hook name may appear **exactly once**, in one format (`.sh` via `bash`, or `.ps1` via `pwsh`/`powershell.exe`). Any non-regular file, unroutable extension, ill-formed stem, duplicate stem, or unknown/excluded event fails the strict startup digest loudly with a recovery `Hint:`.

## Git-Hooks Contract

All 16 lifecycle events and 32 host events are fail-closed gate hooks:

- **Input (`stdin`)**: JSON object `{ event, session?: { sessionID }, context }`. Host class instances inside `context` are stripped to identity keys (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`).
- **Success (`exit 0`)**: Operation continues; `stdout` and `stderr` (up to 16 KB each) are captured into the workspace JSONL runtime log (`owflow-hook-logs-<hash>.jsonl`, 4 MB rotation) and TUI logs popup. Silent successful runs of the catch-all `event` hook are treated as no-ops so hot bus events do not flood logs or TUI status.
- **Failure (`exit != 0`, signal, timeout, or missing interpreter)**: Fails closed with `Blocked: <stderr || stdout || exit reason>. Hint: ...` and aborts the active session.

## Controls & Visibility

- `OWFLOW_HOOKS_DISABLED=1`: bypasses user hooks (built-in destructive-command guard and compaction reminder stay active).
- `OWFLOW_HOOK_TIMEOUT_MS=<ms>`: opt-in per-hook execution timeout.
- `owflow-hooks` CLI (`src/cli/show-hooks.ts`): prints the table or `--json` report and exits `1` on invalid entries.
- TUI **Active hooks** sidebar (`src/tui.ts`): polls `owflow-hooks-<hash>.json` for live status orbs (`Idle`, `In progress`, `Success`, `Error`) and opens the latest session run details + captured `stderr`/`stdout` on click.
