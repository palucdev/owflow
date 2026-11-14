# User Hooks

## Overview

owflow exposes OpenCode's lifecycle events to the host project as git-style script hooks. Every regular file in `<project>/.owflow/hooks/` is validated at plugin initialization and dispatched through owflow's hook handlers — first the built-in destructive-command guard, then the project's scripts. Discovery and validation live in `src/hooks/hooks-registry.ts`, reporting in `src/hooks/hooks-diagnostics.ts`, and runtime log readers in `src/hooks/hooks-persistence.ts`. Subprocess execution and lifecycle dispatch in `src/hooks/hooks-runtime.ts` are decomposed into modular subsystems under `src/hooks/runtime/` (`circuit-breaker.ts`, `process-executor.ts`, `status-recorder.ts`, `failure-policy.ts`); the TUI (`src/tui.ts`) provides the interactive surface.

## Discovery and Naming

- One directory level only: `.owflow/hooks/` (no recursion). A missing or empty directory is a valid no-op.
- The filename stem must be lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and maps mechanically to a dotted event name: `tool-execute-before.sh` → `tool.execute.before`.
- A stem may also name a v1 **host event** (`HOST_EVENT_NAMES`, 32 events), firing when the single `event` hook receives that type (`session-idle.sh` → `session.idle`).
- Each hook name may appear **exactly once**, in one format (`.sh` via `bash`, or `.ps1` via `pwsh`/`powershell.exe`). PowerShell invocations automatically include `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File` to prevent profile load latency, interactive hangs, and execution policy rejections. Any non-regular file, unroutable extension, ill-formed stem, duplicate stem, or unknown/excluded event fails the strict startup digest loudly with a recovery `Hint:`.
- **Digest Modes (`HookDigestMode`)**:
  - `FailFast` (runtime default): Enforces strict startup integrity (`initializeHooksWrapper`). If validation fails during startup, user hooks are bypassed while the built-in destructive-command guard remains active, preventing ambiguous or malformed hook configurations from silently running.
  - `Report` (diagnostic mode): Non-throwing scan used by inspection surfaces like the TUI sidebar (`buildActiveHooksView`) and test suites, returning all collected failures alongside valid entries without interrupting the UI process.

## Hooks Contract

All 16 lifecycle events and 32 host events are fail-closed hooks:

- **Input (`stdin`)**: JSON object `{ event, session?: { sessionID }, context }`. Host class instances inside `context` are stripped to identity keys (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`).
- **Success (`exit 0`)**: Operation continues; `stdout` and `stderr` are captured into a per-hook workspace JSONL runtime log (`owflow-hook-logs-<workspace-hash>-<hook-name>.jsonl`, 4 MB rotation). For `tool.execute.after`, non-empty `stdout` is bridged into the conversation by appending `\n\n[Post-Tool Hint]:\n<stdout>` to `output.output`, injecting hints/warnings directly into agent context without interrupting the turn. Session hook logs are captured in full without truncation and lazy-loaded by scrolling in the TUI logs popup (non-session runs remain capped at 16 KB per stream). Silent successful runs of the catch-all `event` hook are treated as no-ops so hot bus events do not flood logs or TUI status. Clean execution resets failure attempt counters for that check.
- **Failure (`exit != 0`, signal, timeout, or missing interpreter)**:
  - **Tool Execution Hooks with 3-Attempt Escalation**:
    - **`tool.execute.after`**: Post-tool checks (e.g. ESLint). On attempts 1 and 2, mutates `output.output` in-place with `[Post-Tool Check Failed (attempt N/3)]:\n<details>\nHint: ...` without aborting the session, keeping the conversation alive so the agent can inspect and fix errors. On attempt 3 (or upon explicit `CRITICAL:` signal), halts the conversation (`client.session.abort`) and throws a critical halting error.
    - **`tool.execute.before`**: Pre-tool checks and safety guards. On attempts 1 and 2, blocks the tool call by throwing `Blocked: <reason> (attempt N/3). Hint: ...` without aborting the session, allowing OpenCode to deliver the error to the agent to choose an alternative action. On attempt 3 (or upon explicit `CRITICAL:` signal), halts the conversation (`client.session.abort`) and fails loudly.
  - **Other Lifecycle Gate Hooks** (`DISPATCHABLE_EVENTS` excluding `event` and tool hooks, e.g., `chat.message`, `command.execute.before`): Fail closed with `Blocked: <stderr || stdout || exit reason>. Hint: ...` and abort the active session (`client.session.abort`), with per-session abort deduplication (2s cooldown, cleared on `chat.message`).
  - **Reactive Host Events & Catch-All `event`** (`HOST_EVENT_NAMES` such as `session.idle`, `session.status`, `file.edited`, and `event`): Record failure status in the TUI sidebar and JSONL log and reject with `Blocked: ...`, but **never** call `client.session.abort` (preventing `session.idle` re-emission feedback loops). Duplicate triggers of a reactive host event while that event is already in-flight are dropped.
- **Loop Protection (Circuit Breaker)**: If a hook fails 4 consecutive times with inter-run gaps `<= 500ms`, the dispatcher trips a circuit breaker for that `(event, hook, sessionID)` tuple and suppresses subprocess spawns for 30 seconds (`src/hooks/runtime/circuit-breaker.ts`).

### Hard Errors (`CRITICAL:`) vs. Warnings & Hints

Hook authors can decide whether an issue should merely warn/guide the agent or abruptly halt the session:

| Goal | Hook | Exit Code | Message Format | Resulting Agent & Session Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Soft advisory hint** | `tool.execute.after` | `0` | Any stdout text | Tool succeeds. Stderr/stdout captured in logs. Output appended as `[Post-Tool Hint]:\n<stdout>`. Session remains alive. |
| **Soft verification warning** | `tool.execute.after` | `!= 0` | Stderr/stdout without `CRITICAL:` | Attempts 1 & 2: Appends `[Post-Tool Check Failed (attempt N/3)]:\n<output>\nHint: ...` to tool output. Session remains alive; agent self-corrects. |
| **Soft tool block with hint** | `tool.execute.before` | `!= 0` | Stderr/stdout without `CRITICAL:` | Attempts 1 & 2: Blocks tool call with `Blocked: <reason> (attempt N/3). Hint: <hint>`. Session remains alive; agent tries alternative. |
| **Persistent failure halt** | `tool.execute.*` | `!= 0` | Any (attempt 3) | Attempt 3: Session aborted (`client.session.abort`). Throws critical error halting conversation turn. |
| **Immediate hard error** | Any gate hook | `!= 0` | Contains **`CRITICAL:`** in stdout, stderr, or JSON `reason` | **Bypasses retry grace period.** Session aborted immediately on attempt 1. Conversation halted loudly. |

#### Signaling an Immediate Hard Stop (`CRITICAL:`)
If a safety violation is severe and should never be retried by the agent (e.g. tampering with secrets, deleting protected branches, modifying restricted security configurations), include `CRITICAL:` anywhere in the output:

**Bash example (`.owflow/hooks/tool-execute-before.sh`)**:
```bash
#!/usr/bin/env bash
# Immediate hard halt on attempt 1
if [[ "$command" =~ "rm -rf .git" ]]; then
  echo "CRITICAL: Prohibited deletion of version control directory. Halting session." >&2
  exit 1
fi

# Warning with actionable hint (keeps session alive on attempts 1 and 2)
if [[ "$command" =~ "systemctl restart" ]]; then
  echo "Blocked: Service restarting requires explicit admin approval. Hint: Propose a configuration change instead or ask the user." >&2
  exit 1
fi

exit 0
```

**JSON output format**:
Hooks may also output structured JSON. The dispatcher parses the `reason` field:
```json
{
  "decision": "block",
  "reason": "CRITICAL: Production secret keys cannot be touched. Halting conversation. Hint: Contact the security team."
}
```

## Persistence & Runtime Architecture

- **Per-Hook Log Isolation**: Runtime logs are partitioned into flat per-hook files (`owflow-hook-logs-<workspace-hash>-<hook-name>.jsonl`), preventing high-frequency hooks from evicting lower-frequency hooks. A workspace-scoped symlink (`owflow-hooks-latest-<workspace-hash>.jsonl`) links to the most recently written hook log file.
- **Audit Log Deduplication**: `StatusRecorder` tracks written `(runId:status)` pairs in a bounded Set (1,000 entries). Consecutive runs in the same session each produce distinct audit log lines, while duplicate writes of the same run state are prevented.
- **Bounded Tail Log Reader**: `readHookLogRecords` bounds file reads to the trailing 256 KB slice (`MAX_LOG_TAIL_READ_BYTES`) via file descriptors (`O_RDONLY | O_NOFOLLOW`), discarding leading partial lines and caching parsed records by file `mtimeMs` and `size`.
- **Atomic & Debounced Status Snapshots**: `StatusRecorder` writes the TUI snapshot (`owflow-hooks-<workspace-hash>.json`) via atomic temporary file rename (`<file>.<pid>.tmp`). Transient `PENDING` states are debounced with a trailing 50ms `.unref()` timer to eliminate disk thrashing, while terminal states (`SUCCESS`/`FAILURE`) and plugin shutdown (`dispose()`) flush immediately.

## Controls & Visibility

- `OWFLOW_HOOKS_DISABLED=1`: bypasses user hooks (built-in destructive-command guard and compaction reminder stay active).
- `OWFLOW_HOOK_TIMEOUT_MS=<ms>`: opt-in per-hook execution timeout.
- `OWFLOW_HOOKS_STATUS_FILE=<path>`: override path for status snapshot JSON (tests/debug).
- `OWFLOW_HOOK_LOGS_FILE=<path>`: override path for hook runtime JSONL log file (tests/debug).
- TUI **Active hooks** sidebar (`src/tui.ts`): polls `owflow-hooks-<hash>.json` for live status orbs (`Idle`, `In progress`, `Success`, `Error`) and opens session run details + captured `stderr`/`stdout` on click with lazy-loaded scrolling.
