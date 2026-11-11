# User Hooks

## Overview

owflow exposes OpenCode's lifecycle events to the host project as git-style script hooks. Every regular file in `<project>/.owflow/hooks/` is validated at plugin initialization and dispatched through owflow's hook handlers — first the built-in destructive-command guard, then the project's scripts. Discovery and validation live in `src/hooks/hooks-registry.ts`, reporting in `src/hooks/hooks-diagnostics.ts`, and runtime log readers in `src/hooks/hooks-persistence.ts`, with process execution, status/log writing, and dispatch wrapping in `src/hooks/hooks-runtime.ts`; the TUI (`src/tui.ts`) provides the interactive surface.

## Discovery and Naming

- One directory level only: `.owflow/hooks/` (no recursion). A missing or empty directory is a valid no-op.
- The filename stem must be lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and maps mechanically to a dotted event name: `tool-execute-before.sh` → `tool.execute.before`.
- A stem may also name a v1 **host event** (`HOST_EVENT_NAMES`, 32 events), firing when the single `event` hook receives that type (`session-idle.sh` → `session.idle`).
- Each hook name may appear **exactly once**, in one format (`.sh` via `bash`, or `.ps1` via `pwsh`/`powershell.exe`). Any non-regular file, unroutable extension, ill-formed stem, duplicate stem, or unknown/excluded event fails the strict startup digest loudly with a recovery `Hint:`.
- **Digest Modes (`HookDigestMode`)**:
  - `FailFast` (runtime default): Enforces strict startup integrity (`initializeHooksWrapper`). Any validation failure immediately throws an error and halts plugin startup, preventing ambiguous or malformed hook configurations from silently running.
  - `Report` (diagnostic mode): Non-throwing scan used by inspection surfaces like the TUI sidebar (`buildActiveHooksView`) and test suites, returning all collected failures alongside valid entries without interrupting the UI process.

## Hooks Contract

All 16 lifecycle events and 32 host events are fail-closed hooks:

- **Input (`stdin`)**: JSON object `{ event, session?: { sessionID }, context }`. Host class instances inside `context` are stripped to identity keys (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`).
- **Success (`exit 0`)**: Operation continues; `stdout` and `stderr` are captured into the workspace JSONL runtime log (`owflow-hook-logs-<hash>-<hook-name>.jsonl`, 4 MB rotation). Session hook logs are captured in full without truncation and lazy-loaded by scrolling in the TUI logs popup (non-session runs remain capped at 16 KB per stream). Silent successful runs of the catch-all `event` hook are treated as no-ops so hot bus events do not flood logs or TUI status.
- **Failure (`exit != 0`, signal, timeout, or missing interpreter)**:
  - **Lifecycle Gate Hooks** (`DISPATCHABLE_EVENTS` excluding `event`, e.g., `tool.execute.before`, `chat.message`, `command.execute.before`): Fail closed with `Blocked: <stderr || stdout || exit reason>. Hint: ...` and abort the active session (`client.session.abort`), with per-session abort deduplication (2s cooldown, cleared on `chat.message`).
  - **Reactive Host Events & Catch-All `event`** (`HOST_EVENT_NAMES` such as `session.idle`, `session.status`, `file.edited`, and `event`): Record failure status in the TUI sidebar and JSONL log and reject with `Blocked: ...`, but **never** call `client.session.abort` (preventing `session.idle` re-emission feedback loops). Duplicate triggers of a reactive host event while that event is already in-flight are dropped.
- **Loop Protection (Circuit Breaker)**: If a hook fails 4 consecutive times with inter-run gaps `<= 500ms`, the dispatcher trips a circuit breaker for that `(event, hook, sessionID)` tuple and suppresses subprocess spawns for 30 seconds.

## Controls & Visibility

- `OWFLOW_HOOKS_DISABLED=1`: bypasses user hooks (built-in destructive-command guard and compaction reminder stay active).
- `OWFLOW_HOOK_TIMEOUT_MS=<ms>`: opt-in per-hook execution timeout.
- TUI **Active hooks** sidebar (`src/tui.ts`): polls `owflow-hooks-<hash>.json` for live status orbs (`Idle`, `In progress`, `Success`, `Error`) and opens session run details + captured `stderr`/`stdout` on click with lazy-loaded scrolling.
