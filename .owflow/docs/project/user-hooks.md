# User Hooks

## Overview

owflow exposes OpenCode's lifecycle events to the host project as script hooks. Every regular file in `<project>/.owflow/hooks/` is validated at plugin initialization and dispatched through owflow's hook handlers - first the built-in destructive-command guard, then the project's scripts. The wrapper core lives in `src/hooks-wrapper/` and is deliberately platform-agnostic; `src/hooks/plugin-hooks.ts` (server wiring), `src/cli/show-hooks.ts` (CLI), and `src/tui.ts` (TUI) hold the host-specific surfaces.

The channel is designed for the git-hooks/husky convention: project-local automation owned and trusted by the project, with one environment-variable bypass and no sandboxing.

The shared model - event names, classes, registry entries, envelope types, and report rows - lives in `src/types/hook-types.ts`. Directory names (`.owflow`, `hooks`, `tasks`, `docs`) live in `src/utils/workflow-paths.ts` and are referenced by every surface instead of repeated path literals.

## Trust Model

Scripts are the host project's own code, executed with the user's full privileges, with inherited environment, no name/path validation, no default timeout (`OWFLOW_HOOK_TIMEOUT_MS` is opt-in), and no output cap on the hook process itself — the git-hooks/husky convention; the bypass and timeout switches are the operator controls.

Concretely: the digest checks file shape, not file content; scripts inherit the full environment of the OpenCode process; subprocess scripts are spawned with piped stdio and no default timeout (unless `OWFLOW_HOOK_TIMEOUT_MS` is set to a positive integer in milliseconds, which kills the child on expiry and maps the run to `failed`), in-flight children are terminated on plugin `dispose()`, and owflow stops reading a stream after its capture cap rather than imposing an OS-level limit on the child. Before runtime logs, owflow kept no execution audit trail beyond transient `[owflow]` log lines; the persisted JSONL log described below is a bounded local diagnostic record, not a tamper-evident audit trail, and never includes the dispatch envelope or prompt/tool content. Run only hooks you trust, exactly as with git hooks or husky.

## Discovery and Naming

- One directory level only: `.owflow/hooks/` (no recursion). A missing or empty directory is a valid no-op.
- The filename stem must be lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and maps mechanically to a dotted event name: `tool-execute-before.sh` → `tool.execute.before`, `experimental-session-compacting.sh` → `experimental.session.compacting`.
- A stem may also name a v1 **host event**. Those scripts fire when the single `event` hook receives that type: `session-idle.sh` → `session.idle`, `message-part-updated.sh` → `message.part.updated`. The accepted names are the OpenCode v1 `Event` union pinned in `HOST_EVENT_NAMES`; v2-only names such as `session.next.step.ended` are rejected by the digest.
- Each hook name may appear **exactly once**, in one format. Two files with the same stem (for example `check.sh` and `check.ps1`) are a fatal digest error. Different hooks may freely use different formats.
- The extension selects the interpreter:

| Extension | Interpreter | Transport |
| --------- | ----------- | --------- |
| `.sh` | `bash` (resolved via `Bun.which`) | envelope JSON on stdin; result JSON and log output on stdout |
| `.ps1` | `pwsh`, falling back to `powershell.exe` | same as `.sh` |

### Strict Digest

Every enumerated entry is validated; all of the following are fatal registration errors:

- non-regular files - directories, symlinks, sockets
- unroutable extensions - `.ts`, `.js`, `.md`, `.txt`, extensionless dotfiles, etc. (legacy TypeScript/JavaScript hooks must be ported to `.sh`/`.ps1` or removed)
- ill-formed stems - uppercase, underscores, spaces
- duplicate hook names - the same stem in more than one format
- names deriving to neither a dispatchable hook nor a known v1 host event
- names deriving to an excluded event

A single invalid entry throws before any hook registers and drops the entire owflow plugin - including the destructive-command guard - with a `Hint:` naming the recovery.

**Consequence**: `.owflow/hooks/` may contain only hook scripts, one file per hook name. Keep readmes, fixtures, and scratch files elsewhere.

## Universal Gate Semantics

All 16 lifecycle events and 32 host events are gate events governed by universal fail-closed semantics. Every registered hook script in `.owflow/hooks/` fails closed: `blocked` rejects the operation with `Blocked: <reason>.` + actionable `Hint:`; `failed` rejects the operation and terminates the active session. The canonical event names are defined in `HookEvent` / `DISPATCHABLE_EVENTS` and `HOST_EVENT_NAMES` (`src/types/hook-types.ts`).

### Dispatchable Lifecycle Events (16)

| Event | Mutation whitelist |
| ----- | ------------------ |
| `tool.execute.before` | `args` |
| `tool.execute.after` | `title`, `output`, `metadata` |
| `tool.definition` | `description`, `parameters` |
| `chat.message` | - |
| `chat.params` | `temperature`, `topP`, `topK`, `maxOutputTokens`, `options` |
| `chat.headers` | `headers` |
| `command.execute.before` | - |
| `shell.env` | `env` |
| `experimental.chat.messages.transform` | - |
| `experimental.chat.system.transform` | `system` |
| `experimental.session.compacting` | `context` (append-only strings) |
| `experimental.compaction.autocontinue` | `enabled` |
| `experimental.text.complete` | `text` |
| `config` | - |
| `event` | - |
| `dispose` | - |

### Host Event Hooks (32)

A filename may also derive to one of the OpenCode v1 host event types. owflow does not register a host hook per name: the single `event` handler fans out to the matching event-named script, so the script fires only for its own `event.type`. Like all hooks, host event hooks fail closed on non-`ok` outcomes and receive the raw host event under `context.event`; since the host event stream has no output object, returned `mutations` are ignored. An event-named hook and the catch-all `event` hook may coexist - both fire, the event-named one first.

Supported names (`HOST_EVENT_NAMES` in `src/types/hook-types.ts`):

`command.executed`, `file.edited`, `file.watcher.updated`, `installation.update-available`, `installation.updated`, `lsp.client.diagnostics`, `lsp.updated`, `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`, `permission.replied`, `permission.updated`, `pty.created`, `pty.deleted`, `pty.exited`, `pty.updated`, `server.connected`, `server.instance.disposed`, `session.compacted`, `session.created`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`, `todo.updated`, `tui.command.execute`, `tui.prompt.append`, `tui.toast.show`, `vcs.branch.updated`.

The list is pinned to the v1 `Event` union (`@opencode-ai/sdk`), so v2-only names such as `session.next.step.ended` are rejected by the digest rather than silently never firing.

### Where the mutation whitelist comes from

Each whitelisted field is the JSON-representable writable property of that event's **output parameter** in the host's `Hooks` interface (`@opencode-ai/plugin`). For example, the host declares `tool.execute.before` output as `{ args }`, `chat.params` output as `{ temperature, topP, topK, maxOutputTokens, options }`, and `experimental.session.compacting` output as `{ context, prompt? }` (only `context` is exposed, append-only). Events whose output carries rich host objects (`message`, `parts`, `messages`, …) expose no JSON-representable fields and therefore have an empty whitelist. The table is enforced at runtime in `src/hooks-wrapper/dispatcher.ts` (`MUTATION_FIELDS`); a script can mutate only these fields, and anything else is warned and ignored.

### Excluded names

Names that must never be hooked: `permission.ask`, the object-shaped `tool`, `auth`, and `provider` events, and `experimental.provider.small_model`. Filenames deriving to the first four (`permission-ask`, `tool`, `auth`, `provider`) are fatal digest errors. The last is not expressible as a valid kebab-case stem (it contains an underscore) and is additionally guarded at the event-table level.

## Envelope Contract (`owflow-hooks/1`)

Scripts speak one wire version. They read the envelope as JSON on stdin and write the result as JSON on stdout; any other stdout text is captured as hook log output.

### Wrapper → script

```json
{
  "protocol": "owflow-hooks/1",
  "event": "tool.execute.before",
  "class": "gate",
  "session": { "sessionID": "ses_…" },
  "context": { "tool": "bash", "args": { "command": "rm -rf build" } }
}
```

For an event-named hook, `event` is the host event name, `class` is `"gate"` (retained for protocol stability), and `context.event` carries the raw host event (the same shape the catch-all `event` hook receives):

```json
{
  "protocol": "owflow-hooks/1",
  "event": "session.idle",
  "class": "gate",
  "session": { "sessionID": "ses_…" },
  "context": {
    "event": {
      "type": "session.idle",
      "properties": { "sessionID": "ses_…" }
    }
  }
}
```

`class` is always `"gate"` for wire compatibility. `session` is present only when the event carries a session ID; for host events it is read from the event properties (or `message.updated`'s `info.sessionID`). `context` is projected to plain JSON data: host-runtime class instances keep only identity fields (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`), functions and symbols are dropped, and non-finite numbers become `null`.

### Script → wrapper

```json
{ "protocol": "owflow-hooks/1", "status": "ok", "mutations": { "args": { "command": "ls -la" } } }
{ "protocol": "owflow-hooks/1", "status": "blocked", "reason": "rm -rf is not allowed for this agent" }
{ "protocol": "owflow-hooks/1", "status": "failed", "reason": "missing jq" }
```

| Status | Meaning |
| ------ | ------- |
| `ok` | continue; whitelisted `mutations` are applied where the host surface provides an output |
| `blocked` | fail closed: reject the operation with `Blocked: <reason>.` + actionable `Hint:`; the session continues |
| `failed` | fail closed: reject the operation **and end the current session** with `Blocked: <reason>.` + actionable `Hint:` |

Result rules:

- The protocol version and status are required; `reason` must be a string and `mutations` a JSON object, or the result is malformed.
- The result envelope is read from the whole stdout when it is the only content, or from the last object-shaped result line. It is excluded from the captured stdout log.
- Parsed stdout JSON is authoritative over the exit code. A non-zero exit without a parseable result maps to `failed` (stderr becomes the reason when present); a signal kill maps to `failed` with the signal in the reason; stdout with no result and exit 0 means `ok`.
- Plain stdout text is log output and never fails the run by itself. A line that looks like a result (`{` plus a `"protocol"` or `"status"` key) but does not parse as one still maps to `failed` on a zero exit, so a broken envelope can never pass silently. The envelope must stay on one line at the end of stdout; put it last when the script also logs.
- Mutations naming a field outside the event's whitelist are warned and ignored - they never silently alter output. Host event hooks have no output, so all their mutations are ignored.
- `experimental.session.compacting` is the one stateful mutation: `context` must be an array of strings and is **appended** after the built-in state re-read reminder; non-arrays and non-string entries are warned and dropped.

## Example Scripts

The same logging hook - it records the event, session, tool, and command from the envelope - in both supported formats. Save **one** variant as `.owflow/hooks/tool-execute-before.<ext>`; a hook name may appear in exactly one format. Both examples return a complete `owflow-hooks/1` result, so they can be copied verbatim.

Scripts can log to stdout or stderr; both are captured automatically and shown in the runtime logs popup. A valid result envelope is consumed from stdout and excluded from the captured text, so print it as the last line after any diagnostics. The Bash and PowerShell examples append to `.owflow/hook-events.log` as a durable example. Their working directory is the project root. Keep ad-hoc log files outside `.owflow/hooks/` - the strict digest allows only hook scripts there.

### Bash

The wrapper invokes `bash` directly, so the script needs no execute bit. It reads the envelope from stdin, uses `jq` to extract fields, appends a line to `.owflow/hook-events.log`, and writes the result to stdout.

```bash
#!/usr/bin/env bash
set -u

envelope="$(cat)"
event="$(jq -r '.event // "unknown"' <<<"$envelope")"
session="$(jq -r '.session.sessionID // "unknown"' <<<"$envelope")"
tool="$(jq -r '.context.tool // "?"' <<<"$envelope")"
command="$(jq -r '.context.args.command // ""' <<<"$envelope")"

printf '%s [example-hook] %s session=%s tool=%s command=%s\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$event" "$session" "$tool" "$command" >> .owflow/hook-events.log

printf '%s\n' '{"protocol":"owflow-hooks/1","status":"ok"}'
```

### PowerShell

The wrapper invokes `pwsh` (falling back to `powershell.exe`) directly; the envelope arrives on stdin and the result must be JSON on stdout. `ConvertFrom-Json` reads the fields and `Add-Content` appends the line.

```powershell
$ErrorActionPreference = "Stop"

$envelope = [Console]::In.ReadToEnd() | ConvertFrom-Json
$context = $envelope.context
$session = if ($envelope.session.sessionID) { $envelope.session.sessionID } else { "unknown" }
$stamp = Get-Date -Format o

$line = "$stamp [example-hook] $($envelope.event) session=$session tool=$($context.tool) command=$($context.args.command)"
Add-Content -Path .owflow/hook-events.log -Value $line

@{ protocol = "owflow-hooks/1"; status = "ok" } | ConvertTo-Json -Compress
```

### Event-named hook

Save a script as `.owflow/hooks/session-idle.sh` and owflow invokes it only for the `session.idle` host event - no envelope filtering is needed. The repository's own bundled build hook (`.owflow/hooks/session-idle.sh`) is a working example: it drains stdin, checks `git status` for source changes, and runs `bun run build` only when the tree is dirty. It prints the successful build output to stdout before its result envelope (captured in the logs popup) and writes the build tail plus a failed result to stderr on failure; the TUI records every settled run because `session.idle` is an event-named hook. Note: running a full build on `session.idle` is tailored to owflow's fast (~12 s) build; host projects with slower builds should adapt or omit a `session-idle` build hook (or set `OWFLOW_HOOK_TIMEOUT_MS`).

## Ordering Rules

1. **Guard first**: inside `tool.execute.before`, owflow's built-in destructive-command guard always runs before any user script, so a blocked destructive command never reaches hooks.
2. **Deterministic order**: entries sort by event name using a locale-independent comparator shared by the registry, CLI, and TUI. Duplicate names are rejected before dispatch.
3. **Event fan-out**: for a host event, the matching event-named hook runs before a catch-all `event` hook.
4. **Compaction**: the built-in state reminder is added first; user hook appends follow in registry order.

## Execution Semantics

- **Universal fail-closed**: a `blocked` outcome, an unavailable interpreter, or a `failed` outcome throws a `Blocked:`-prefixed error with a `Hint:` that names the script and the recovery (fix/remove + restart, or the bypass). A `failed` hook additionally calls the host's session-abort endpoint so the current session stops; a `blocked` hook rejects only the operation. The first failing hook stops the event's remaining scripts.
- **Missing interpreters always fail closed**: any hook whose interpreter is missing maps to `will fail closed at fire` in the registry and throws a missing-interpreter rejection at fire time (ending the active session if a session ID is present).

## Runtime Logs

Every user-hook fire is considered for the per-workspace JSONL log. A fire is any hook run, or a catch-all `event` run that captured output or non-ok outcome; only a silent successful catch-all `event` run is a no-op and appends nothing. Consecutive runs with identical event, hook, session, status, outcome, reason, exit code, signal, and captured output are coalesced into the first line instead of being appended again, so a persistent failure or an unchanged repeated output cannot flood the file; a changed outcome, session, reason, or capture starts a new line. The newest line for a run that started in the current session is the one the popup displays:

`path.join(os.tmpdir(), "opencode", "owflow-hook-logs-<sha256(realpath(workspace))[0..16]>.jsonl")`

- **Automatic capture, no script changes**: hooks contribute stdout, stderr, the exit code, and the terminating signal. A valid `owflow-hooks/1` result envelope is parsed from stdout and omitted from the captured text; all other stdout is stored as the `stdout` log field. Captured output is never forwarded to OpenCode's process output: the runtime log file and the TUI popup are its only surfaces. The dispatch envelope, prompt text, and tool arguments are never serialized.
- **Record shape**: `version`, `runId` (`<event>#<counter>`), `pid`, `workspace`, `event`, `hook` path, `name`, optional `sessionID`, `startedAt`, `finishedAt`, `durationMs`, `status` (`success`/`failure`), `outcome` (`ok`/`blocked`/`failed`), optional `reason`, `exitCode`, `signal`, `stdout`, `stderr`, and `truncated`. Skipped interpreter runs are recorded as `failure` with the reason and no capture. Older lines that still carry `class`, `runnerClass`, or `errorStack` remain readable.
- **Bounds and rotation**: each captured stream is capped at 16 KB, each JSONL record at 32 KB, and the file at 4 MB. On the next append past the file cap the current file is renamed to `<file>.1` (any older backup is removed) and a fresh file starts. One backup is intentional; older history is discarded.
- **Best effort**: log capture and file I/O failures warn once with `[owflow] hooks:` and never change a hook result, gate rejection, session abort, or plugin startup.
- **Local and unredacted**: the file lives in the local OpenCode tmp directory and may contain sensitive output produced by the hook itself. owflow performs no redaction; treat it like any other local diagnostic artifact. `OWFLOW_HOOK_LOGS_FILE` overrides the computed path for tests and manual debugging.

### How the TUI renders script output

Each script stream has exactly one destination, and the TUI shows only what the capture path stores:

| Script stream | Destination | TUI rendering |
| ------------- | ----------- | ------------- |
| stdout with a valid `owflow-hooks/1` result | result channel | parsed for `status`/`reason`/`mutations`; the envelope line itself is never displayed |
| other stdout text | captured `stdout` | raw text under `--- stdout ---` in the logs popup; the exit code decides unless a result line is present |
| stdout line that looks like a result but is malformed | malformed result | fails closed on a zero exit (raw stdout is captured) |
| stderr | captured `stderr` | raw text under `--- stderr ---` in the logs popup; scripts should write only errors here, and output is never forwarded to OpenCode's process output |
| exit code / signal | capture metadata | `Exit:` and `Signal:` lines in the run-detail popup |

- **Active hooks row**: `Idle`, `In progress`, `Success`, or `Error` follows the live status snapshot. A settled `Success`/`Error` stays until the hook fires again.
- **Run-detail popup** (click a row): `Event`, `Status` (`Success` or `Error`) with duration, `Time` (ISO-8601), `Session`, `Exit`/`Signal`, and `Reason`. Captured streams are deliberately omitted here; the popup body is bounded by a 4,000-character budget.
- **Logs popup** (`View logs`): `--- stderr ---` first, then `--- stdout ---`, each containing the captured text verbatim. When neither stream was captured it shows `No output captured for this run.`; when any capture hit a cap it appends `[output truncated]`. The body scrolls when it exceeds the popup viewport, and the store caps each stream at 16 KB.
- **Visibility rule**: event-named hooks (`session-idle`, `message-updated`, ...) and the one-shot `config`/`dispose` hooks record every settled run, including a silent success: the row turns green `Success` and the logs popup shows `No output captured for this run.` Only a silent successful catch-all `event` run is a no-op (it would otherwise light up on every host event), so the catch-all needs captured output or a failure to appear. Failures are always recorded, with stderr and the reason available in the two popups. The bundled `session-idle.sh` build hook therefore behaves like an ordinary script: silent success, errors on stderr.

## Visibility Surfaces

All surfaces render the same row model - `path | event | interpreter | status` - from the same pure report module, so they agree by construction.

| Surface | What it shows | Freshness |
| ------- | ------------- | --------- |
| Startup snapshot | `[owflow] hooks: N loaded[, M invalid]` plus one line per row, inside the config banner | live registry at startup |
| `owflow-hooks` CLI | table by default, `--json` for machine output; scans `./.owflow/hooks/` relative to the process CWD; exits 1 when any invalid entry is found; requires `bun` on PATH (same runtime as OpenCode) | would-load scan, always labeled `effective after next restart` |
| TUI Active hooks panel | an always-on right-hand sidebar panel listing `Active hooks:` and one `- <name>` line per loaded hook, with live runtime colors and a click-to-open latest-run popup scoped to the current session; digests the current workspace at activation; no command invocation, session, message, or model turn | would-load scan (`effective after next restart`) plus a 200 ms live status poll; the popup reads the runtime log at click time and ignores runs from before the panel opened |

Status vocabulary: `registered`, `will fail closed at fire`, `invalid: <error>`, and `hooks bypassed (OWFLOW_HOOKS_DISABLED=1)`. The CLI and TUI re-derive with the same pure modules rather than reading the live registry (separate process by construction), and report invalid entries instead of failing fast.

The TUI additionally renders **runtime status** for user hooks using a colored orb (`•`, matching the MCP status style): grey (`theme.textMuted`) before a hook has fired, yellow (`theme.warning`) while a hook is running, green (`theme.success`) after a successful fire, and red (`theme.error`) after a failed, blocked, or unavailable-interpreter run. Every hook reports `In progress` while its code runs. A successful catch-all `event` run that captured no stdout/stderr is a no-op: its pending state is cleared and the row returns to its previous outcome (or `Idle`) without writing a log, so the high-frequency `event` hook does not leave a terminal trace. Event-named hooks (`session-idle`, ...) and the one-shot `config`/`dispose` hooks record their outcome even when silent, so a successful `session-idle` fire still shows green `Success` with no captured output. A settled success or error stays visible until that hook fires again (the next run first shows yellow `In progress`, then its new outcome), so the row always reflects the last real fire. A session's panel also ignores runs that started before that panel opened, so a new session always begins with every row `Idle` - including the high-frequency `event` hook - even when the status snapshot still holds successes from an earlier session or a previous process; the next real fire lights the row. The hook name uses the normal `theme.text` color (hover uses `theme.primary`), and the current state follows it in muted grey as `Idle`, `In progress`, `Success`, or `Error`. Each openable row ends with a muted `›` and highlights on hover. The `Active hooks:` heading also uses `theme.text` like other sections. Status is recorded by owflow's dispatcher; scripts need no changes.

The status transport is one overwritten JSON snapshot per workspace in OpenCode's tmp directory: `path.join(os.tmpdir(), "opencode", "owflow-hooks-<sha256(realpath(workspace))[0..16]>.json")`. Every update atomically replaces the previous content (one reused `.tmp` name), so no per-run or timestamped files accumulate. Multiple OpenCode instances on the same workspace share the file and last writer wins. The `pid` field is diagnostic only; the TUI does not require a PID match. `OWFLOW_HOOKS_STATUS_FILE` overrides the computed path for tests and manual debugging.

Clicking a row opens a centered run-detail popup with the latest persisted run for that hook in the current session: status, duration, finish time, session, exit code or signal, reason, and the full path of the workspace log file. Runs that started before that session's panel opened are ignored, so a fresh session does not replay the previous process's last record. A **View logs** button at the bottom opens a second popup with the captured stderr/stdout in a scrollable view; the detail view stays bounded by a fixed character budget. Rows advertise the detail popup with a trailing `›` and a hover highlight. The click path does not depend on the status poll; if no run has been recorded in the session (or the log is missing/malformed) the TUI shows an info toast instead of throwing. Rows remain non-interactive when `OWFLOW_HOOKS_DISABLED=1`.

The CLI and TUI scans are **digest-only**: they validate naming, extension, event derivation, and duplicate names. Discovery is structural for every script, so the CLI, TUI, and startup banner report the same would-load set; no script is imported or executed.

## Restart to Reload

There is no file watcher for **hook-set discovery**, and the hook set is not persisted: it is digested exactly once at plugin initialization. Scripts added, edited, or removed take effect only after the next OpenCode restart - which is why the CLI and TUI label every report `effective after next restart`. Runtime *execution status* is different: it is live, persisted as the single overwritten status snapshot (cleared at startup), and accumulated separately in the append-only runtime log for the popup and external inspection.

## Bypass and Recovery

- `OWFLOW_HOOKS_DISABLED=1` skips the digest, registry, dispatch, status store, runtime log store, and TUI status polling entirely; no status or log file is written, and clicking a row does nothing. The startup banner reports `hooks bypassed (OWFLOW_HOOKS_DISABLED=1)`. The built-in hooks (destructive-command guard, post-compaction reminder) remain active, and invalid hook files cannot drop the plugin in this mode.
- `OWFLOW_HOOK_TIMEOUT_MS=<milliseconds>` imposes an opt-in per-execution timeout on hook subprocesses; a script that exceeds the timeout is killed and resolves to `failed` (`process timed out after <ms>ms`). In-flight child processes are also killed on plugin `dispose()`.
- On a fail-fast registration error, fix or remove the offending file and restart OpenCode - or start with the bypass. The destructive guard drops with the plugin until one of the two is done, which is why the error is loud and names both options.
- A `failed` gate ends the current session; after the abort, fix or remove the failing script and restart OpenCode before continuing.
- To roll back the plugin version in `opencode.json`, pin `"plugin": ["owflow@0.6.1"]` and restart OpenCode.

## Support Declaration

- **PowerShell (`.ps1`)**: supported. The interpreter is resolved at init (`pwsh`, falling back to `powershell.exe`), uses the same subprocess runner and `owflow-hooks/1` envelope as `.sh`, and was verified with a parity spike covering ok/blocked/failed/malformed/exit-code/empty-stdout cases.
- **TUI Active hooks panel**: supported. It registers in the host's right-hand `sidebar_content` slot with the shared report data, polls the runtime status snapshot for live colors, and opens the latest runtime-log record from the current session on row click; registration, color mapping, polling, pruning, dispose, popup formatting, and toast fallbacks are covered by the TUI test suite.
- The CLI and startup banner remain the unconditional fallback visibility surfaces.

## Implementation Map

- `src/types/hook-types.ts` - shared model: `HookEvent` enum, event/class table, the pinned v1 `HOST_EVENT_NAMES` list, registry and envelope types, report row types, dispatcher contracts
- `src/utils/workflow-paths.ts` - global `.owflow` directory constants and path helpers
- `src/hooks-wrapper/registry.ts` - naming/extension tables, interpreter resolution (`Bun.which`), strict directory digest (including duplicate-name rejection), registry builder, and the unified `scanHooks` one-call scan
- `src/hooks-wrapper/runners.ts` - `owflow-hooks/1` envelope build/parse and the subprocess runner (including capped stream reading and capture attachment)
- `src/hooks-wrapper/dispatcher.ts` - per-event gate/observe translation, failed-gate session ending, the mutation whitelist, and independent best-effort runtime-status and run-log reports
- `src/hooks-wrapper/status.ts` - per-workspace status-file path, atomic overwritten snapshot store (50 ms trailing flush), and the validating reader used by the TUI
- `src/hooks-wrapper/hook-logs.ts` - per-workspace JSONL path, bounded append-only log store with one-file rotation, and the tail reader/latest-record selector used by the TUI
- `src/hooks-wrapper/report.ts` - shared row model and three renderers
- `src/hooks-wrapper/shared.ts` - shared `Blocked:` prefix, JSON guards, and comparator
- `src/hooks/plugin-hooks.ts` - server adapter (wrapper initialization, passthrough handlers, host-event fan-out from the single `event` hook, dispatch wiring)
- `src/index.ts` - plugin factory composition (banner snapshot, guard-first dispatch)
- `src/cli/show-hooks.ts` - `owflow-hooks` CLI
- `src/tui.ts` - TUI sidebar slot registration
- Mirrored suites: `src/__tests__/hooks-wrapper/`, `src/__tests__/cli/show-hooks.test.ts`, `src/__tests__/tui.test.ts`

No new runtime dependencies: the wrapper ships on host built-ins only (`Bun.spawn`, `Bun.which`, `node:` modules, JSON) plus the host-provided `@opentui/solid` runtime for the TUI panel.
