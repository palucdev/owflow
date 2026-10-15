# User Hooks

## Overview

owflow exposes OpenCode's lifecycle events to the host project as script hooks. Every regular file in `<project>/.owflow/hooks/` is validated at plugin initialization and dispatched through owflow's hook handlers - first the built-in destructive-command guard, then the project's scripts. The wrapper core lives in `src/hooks-wrapper/` and is deliberately platform-agnostic; only `src/index.ts` (server adapter) and `src/tui.ts` (TUI adapter) know the host contract.

The channel is designed for the git-hooks/husky convention: project-local automation owned and trusted by the project, with one environment-variable bypass and no sandboxing.

## Trust Model

scripts are the host project's own code, executed with the user's full privileges, with inherited environment, no name/path validation, no timeouts, no output caps, no audit trail — the git-hooks/husky convention; the bypass switch is the only control.

Concretely: the digest checks file shape, not file content; scripts inherit the full environment of the OpenCode process; subprocess scripts are spawned with piped stdio and no timeout or output cap; owflow keeps no execution audit trail beyond the transient `[owflow]` log lines. Run only hooks you trust, exactly as with git hooks or husky.

## Discovery and Naming

- One directory level only: `.owflow/hooks/` (no recursion). A missing or empty directory is a valid no-op.
- The filename stem must be lowercase kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and maps mechanically to a dotted event name: `tool-execute-before.sh` → `tool.execute.before`, `experimental-session-compacting.ts` → `experimental.session.compacting`.
- The extension selects the runner class and interpreter:

| Extension | Runner class | Interpreter | Transport |
| --------- | ------------ | ----------- | --------- |
| `.ts` | in-process | `import()` (Bun runtime) | envelope passed to the default export; the returned value is the result |
| `.js` | in-process | `import()` (Bun runtime) | same as `.ts` |
| `.sh` | subprocess | `bash` (resolved via `Bun.which`) | envelope JSON on stdin; result JSON on stdout |
| `.ps1` | subprocess | `pwsh`, falling back to `powershell.exe` | same as `.sh`; **verification-pending (A7)** |

In-process scripts must `export default` an async handler: `async (envelope) => result`. A handler may be side-effect-only and return nothing.

### Strict Digest (A1)

Every enumerated entry is validated; all of the following are fatal registration errors:

- non-regular files - directories, symlinks, sockets
- unroutable extensions - `.md`, `.txt`, extensionless dotfiles, etc.
- ill-formed stems - uppercase, underscores, spaces
- names deriving to a non-dispatchable event
- names deriving to an excluded event

A single invalid entry throws before any hook registers and drops the entire owflow plugin - including the destructive-command guard - with a `Hint:` naming the recovery. In-process scripts whose default export is missing or whose import throws are equally fatal at registration, wrapped with the same plugin-dropped hint.

**Consequence**: `.owflow/hooks/` may contain only hook scripts. Keep readmes, fixtures, and scratch files elsewhere.

## Event Classes (R6)

16 events are dispatchable: 13 gates and 3 observe. Gate hooks govern whether the operation proceeds and fail closed; observe hooks are advisory and can never break a session.

### Gate events (13)

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

### Observe events (3)

| Event | Mutation whitelist |
| ----- | ------------------ |
| `config` | - |
| `event` | - |
| `dispose` | - |

### Excluded names

Names that must never be hooked: `permission.ask`, the object-shaped `tool`, `auth`, and `provider` events, and `experimental.provider.small_model`. Filenames deriving to the first four (`permission-ask`, `tool`, `auth`, `provider`) are fatal digest errors. The last is not expressible as a valid kebab-case stem (it contains an underscore) and is additionally guarded at the event-table level.

## Envelope Contract (`owflow-hooks/1`)

Both runner classes speak one wire version. Subprocess scripts read the envelope as JSON on stdin and write the result as JSON on stdout; in-process handlers receive the same object and return the result object.

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

`class` is derived from the same event table the registry uses, so it can never disagree. `session` is present only when the event carries a session ID. `context` is projected to plain JSON data: host-runtime class instances keep only identity fields (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`), functions and symbols are dropped, and non-finite numbers become `null`.

### Script → wrapper

```json
{ "protocol": "owflow-hooks/1", "status": "ok", "mutations": { "args": { "command": "ls -la" } } }
{ "protocol": "owflow-hooks/1", "status": "blocked", "reason": "rm -rf is not allowed for this agent" }
{ "protocol": "owflow-hooks/1", "status": "failed", "reason": "missing jq" }
```

| Status | Gate meaning | Observe meaning |
| ------ | ------------ | --------------- |
| `ok` | continue; whitelisted `mutations` are applied | log nothing; mutations, if whitelisted, are still applied where the host surface supports it |
| `blocked` | fail closed with `Blocked: <reason>.` + actionable `Hint:` | log `[owflow]` warning and continue |
| `failed` | fail closed (a broken gate must never silently pass) | log `[owflow]` warning and continue |

Result rules:

- The protocol version and status are required; `reason` must be a string and `mutations` a JSON object, or the result is malformed.
- A malformed in-process return, or an unparseable subprocess stdout, maps to `failed`.
- In-process: returning `undefined` means `ok` (side-effect-only script); throwing `Blocked: <reason>` means `blocked`; any other throw means `failed`.
- Subprocess: parsed stdout JSON is authoritative over the exit code. A non-zero exit without parseable JSON maps to `failed` (stderr becomes the reason when present); a signal kill maps to `failed` with the signal in the reason; an empty stdout with exit 0 means `ok`.
- Mutations naming a field outside the event's whitelist are warned and ignored - they never silently alter output.
- `experimental.session.compacting` is the one stateful mutation: `context` must be an array of strings and is **appended** after the built-in state re-read reminder; non-arrays and non-string entries are warned and dropped.

## Ordering Rules

1. **Guard first**: inside `tool.execute.before`, owflow's built-in destructive-command guard always runs before any user script, so a blocked destructive command never reaches hooks.
2. **Deterministic order**: entries sort by event name, then stem, then extension rank - `.ts` (0) &lt; `.js` (1) &lt; `.sh` (2) &lt; `.ps1` (3) - using a locale-independent comparator shared by the registry, CLI, and TUI.
3. **Same-stem collisions are legal**: `check.ts` and `check.sh` both register and both run, `.ts` first.
4. **Compaction**: the built-in state reminder is added first; user hook appends follow in registry order.

## Execution Semantics

- **Gate fail-closed**: a `blocked`/`failed` outcome, or an unavailable interpreter, throws a `Blocked:`-prefixed error with a `Hint:` that names the script and the recovery (fix/remove + restart, or the bypass). The first failing gate stops the event's remaining scripts.
- **Observe log-and-continue**: failures warn with the `[owflow]` prefix; installation and sessions are never broken by an observe script.
- **Missing interpreters are not registration errors**: the registry records `will fail closed at fire` for gate scripts and `skipped (no interpreter)` for observe scripts. Install the interpreter or remove the script to change this.
- **Registration-time import validation**: in-process scripts are imported once during initialization so a broken module fails fast at startup rather than at first fire.

## Visibility Surfaces (R7)

All three surfaces render the same row model - `path | event | class | interpreter | status` - from the same pure report module, so they agree by construction.

| Surface | What it shows | Freshness |
| ------- | ------------- | --------- |
| Startup snapshot | `[owflow] hooks: N loaded[, M invalid]` plus one line per row, inside the config banner | live registry at startup |
| `owflow-hooks` CLI | table by default, `--json` for machine output; scans `./.owflow/hooks/` relative to the process CWD; exits 1 when any invalid entry is found; requires `bun` on PATH (same runtime as OpenCode) | would-load scan, always labeled `effective after next restart` |
| TUI `/owflow:show-hooks` | the same table in an `api.ui.toast`; digests the current workspace at activation; no session, message, or model turn | would-load scan, `effective after next restart`; **verification-pending (A7, S11)** |

Status vocabulary: `registered`, `will fail closed at fire`, `skipped (no interpreter)`, `invalid: <error>`, and `hooks bypassed (OWFLOW_HOOKS_DISABLED=1)`. The CLI re-derives with the same pure modules rather than reading the live in-process registry (separate process by construction), and reports invalid entries instead of failing fast.

The CLI and TUI scans are **structural only**: they validate naming, extension, and event derivation but never import `.ts`/`.js` scripts. A structurally valid in-process hook that throws on import (or lacks a default export) still renders as `registered` here while the live plugin would drop at startup - import validation runs exclusively at plugin startup (fail-fast), and only the startup banner reflects the import-validated set.

## Restart to Reload

There is no file watcher and no persisted snapshot: the hook set is digested exactly once at plugin initialization. Scripts added, edited, or removed take effect only after the next OpenCode restart - which is why the CLI and TUI label every report `effective after next restart`.

## Bypass and Recovery

- `OWFLOW_HOOKS_DISABLED=1` skips the digest, registry, and dispatch entirely; the startup banner reports `hooks bypassed (OWFLOW_HOOKS_DISABLED=1)`. The built-in hooks (destructive-command guard, post-compaction reminder) remain active, and invalid hook files cannot drop the plugin in this mode.
- On a fail-fast registration error, fix or remove the offending file and restart OpenCode - or start with the bypass. The destructive guard drops with the plugin until one of the two is done, which is why the error is loud and names both options.

## Gated Declarations (A7)

- **PowerShell (`.ps1`)**: implemented and routed (interpreter probe with `pwsh`/`powershell.exe` fallback, subprocess runner, shared envelope). The documented *support declaration* is pending the dev-verify S10 PowerShell parity spike; until then it is labeled verification-pending.
- **TUI `/owflow:show-hooks`**: implemented and registered as a palette command. The documented *support declaration* is pending the dev-verify S11 in-UI pass; until then it is labeled verification-pending.
- The CLI and the startup banner are the unconditional fallback visibility surfaces.

## Implementation Map

- `src/hooks-wrapper/types.ts` - shared vocabulary (type-only)
- `src/hooks-wrapper/derivation.ts` - naming, extension rank, event table, comparator
- `src/hooks-wrapper/digest.ts` - strict directory enumeration (`throw` fail-fast / `report` CLI modes)
- `src/hooks-wrapper/registry.ts` - frozen registry with interpreter availability
- `src/hooks-wrapper/interpreters.ts` - `.sh`/`.ps1` interpreter resolution (`Bun.which`)
- `src/hooks-wrapper/envelope.ts` - `owflow-hooks/1` build/parse
- `src/hooks-wrapper/runners.ts` - in-process and subprocess runners
- `src/hooks-wrapper/execution-core.ts` - `run(entry, envelope) → Outcome` seam
- `src/hooks-wrapper/dispatcher.ts` - per-event gate/observe translation and mutation whitelist
- `src/hooks-wrapper/report.ts` - shared row model and three renderers
- `src/index.ts` - server adapter (banner snapshot, guard-first dispatch)
- `src/cli/show-hooks.ts` - `owflow-hooks` CLI
- `src/tui.ts` - TUI palette layer
- Mirrored suites: `src/__tests__/hooks-wrapper/`, `src/__tests__/cli/show-hooks.test.ts`, `src/__tests__/tui.test.ts`

No new runtime dependencies: the wrapper ships on host built-ins only (`import()`, `Bun.spawn`, `Bun.which`, `node:` modules, JSON).
