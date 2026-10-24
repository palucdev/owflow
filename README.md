![Owflow logo](logo.png)

# Owflow

**Structured, standards-aware development workflows for OpenCode**

Describe what you want to build, and the plugin handles the rest - from specification through implementation to verification - while enforcing your project's coding standards at every step.

Started as a simple OpenCode fork of [Maister Claude Code plugin](https://github.com/SkillPanel/maister), Owflow aims to deliver production ready workflows using the full [Opencode](https://opencode.ai/) plugin support.

## What You Get

- **Guided workflows** for features, bug fixes, enhancements, performance, migrations and research
- **Auto-discovered standards** from your codebase - config files, source patterns, and documentation are analyzed and enforced throughout every workflow
- **Test-driven implementation** with automated planning, incremental verification, and full test suite runs before completion
- **Pause and resume** any workflow - state is preserved across sessions
- **Production readiness checks** including code review, reality assessment, and pragmatic over-engineering detection

## Getting Started

### Directory Structure

```
owflow/
├── docs/                   # Plugin documentation (commands, workflows)
├── scripts/                # Build and utility scripts
└── src/                    # Source code
    ├── __tests__/          # Test suites
    ├── agents/             # Agent definitions and prompts (.md)
    ├── commands/           # Maintained content commands (.md); the rest are generated from skill frontmatter
    ├── configuration/      # Handlers for agent, command, and skill configurations
    ├── hooks/              # OpenCode lifecycle hooks (tool execution, compaction)
    ├── skills/             # Workflows, orchestrators, and reusable skills
    ├── templates/          # Orchestrator state and task YAML templates
    ├── tools/              # Custom OpenCode tool implementations
    ├── types/              # TypeScript type definitions
    ├── utils/              # Internal utility functions
    └── index.ts            # Main plugin entry point
```

### Prerequisites

- [Opencode](https://opencode.ai/) CLI installed and configured
- [Node.js](https://nodejs.org/) >= 25

### Installation

#### Add owflow to the `plugin` array in your `opencode.json` ([global or project-level](https://opencode.ai/docs/plugins/#load-order)):

To use it across multiple repos it is advised to use the global level:

Linux/MacOS:

```sh
~/.config/opencode/opencode.json
```

Windows:

```powershell
\Users\YourUsername\.config\opencode\opencode.json
```

In `opencode.json`:

```json
{
  ...
  "plugin": ["owflow@latest"]
  ...
}
```

### Initial project setup

Initialize your project to auto-detect coding standards and generate project documentation:

```bash
/owflow:flow-init
```

This scans your codebase and creates `.owflow/` with standards, docs, and task folders. May take a few minutes on larger projects.

If you have another project already using Owflow, you can reuse its standards as a starting point:

```bash
/owflow:flow-init --standards-from=/path/to/other-project
```

### First Workflow

```bash
/owflow:development Add user profile page with avatar upload
```

Or just discuss your task with Agent and then run:

```bash
/owflow:development
```

The plugin picks up context from your conversation - no arguments needed. Prefer everything in one session? Use `/owflow:goal-development` (autonomous mode) instead - it runs the same pipeline without handoffs between phases (subskills run back-to-back in one session).

## How It Works

1. You describe a task - either as an argument or just in conversation
2. The plugin classifies it (feature, bug, enhancement, etc.) and proposes a workflow
3. You confirm, and it guides you through the pipeline of development subskills: **analysis → spec → plan → implement → verify → finalize**
4. At each phase, it asks for your input and decisions
5. You get tested, verified code with a detailed work log

All artifacts are saved in `.owflow/tasks/` organized by type and date.

### Context-Aware Commands

Every workflow command works without arguments. The plugin reads your current conversation to extract the task description and auto-detect the task type:

```
You: "The login page throws a 500 error when the session expires"
You: /owflow:development
→ Auto-detects: bug fix, extracts description from conversation
```

```
You: /owflow:standards-update
→ Scans conversation for patterns like "we always use..." or "prefer X over Y"
```

You can always be explicit when you prefer - arguments and flags simply override the auto-detection.

## Supported Workflows

| Command                    | Use When                                       |
| -------------------------- | ---------------------------------------------- |
| `/owflow:development`      | Features, bug fixes, enhancements              |
| `/owflow:research`         | Research with synthesis and solution design    |
| `/owflow:performance`      | Optimizing speed or resource usage             |
| `/owflow:migration`        | Changing technologies or patterns              |

Use `/owflow:work` as a single entry point — it classifies the task with the `task-classifier` subagent and routes to the right workflow.

### Autonomous Workflows

Each workflow has a `/owflow:goal-*` equivalent that runs the same pipeline back-to-back in one session, pausing at decision gates between steps. Both modes share one task state, so you can mix them freely on a single task.

| Command                    | Runs                          |
| -------------------------- | ----------------------------- |
| `/owflow:goal-development` | The full development pipeline |
| `/owflow:goal-research`    | The full research pipeline    |
| `/owflow:goal-performance` | The full performance pipeline |
| `/owflow:goal-migration`   | The full migration pipeline   |

### Research Utility

| Command                       | Use When                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `/owflow:research-quick "<description>"` | Condensed research: brief → plan → gather → synthesis in one pass     |
| `/owflow:research-fork <task-path> ["<what this fork should explore>"]` | Branch a research task and re-run from the fork point with different choices |

### Migration Subskills

Migration runs as a pipeline of eight standalone subskills — `/owflow:migration-analyze`, `/owflow:migration-target`, `/owflow:migration-spec`, `/owflow:migration-plan`, `/owflow:migration-implement`, `/owflow:migration-verify`, `/owflow:migration-fix`, `/owflow:migration-finalize` — with `/owflow:migration` as the dispatcher and `/owflow:goal-migration` running the whole pipeline in one session. Flags: `--from=<slug>`, `--type=code|data|architecture|general`, `--no-web-research`.

### Quick Commands

For smaller tasks that don't need a full workflow:

| Command                          | Use When                                                    | Artifacts                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/owflow:dev-spec --quick`       | Standards-aware, resumable spec before any plan — spec only | `orchestrator-state.yml`, `analysis/quick-analysis.md`, `analysis/requirements.md`, `implementation/spec.md`                              |
| `/owflow:dev-plan --quick`       | Standards-aware, resumable plan before coding — plan only   | `orchestrator-state.yml`, `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`                |
| `/owflow:dev-implement --quick`  | Task is clear, no architectural decisions needed            | `orchestrator-state.yml`, `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`, `work-log.md` |
| `/owflow:dev-bugfix`             | Quick TDD-driven bug fix — write failing test, fix, verify  | `orchestrator-state.yml`, `analysis/findings.md`, `summary.md`                                                                            |

Every quick lane creates a standard development task under `.owflow/tasks/development/` (full `orchestrator-state.yml` with the lane as `orchestrator.entry_point`) and stops at that lane's exit gate — continuable later by any dev-* subskill (`/owflow:dev-verify`, `/owflow:development <task-path>`, …).

Quick development uses the standard pipeline instead: `/owflow:dev-implement --quick "<description>"` bootstraps a regular development task (`orchestrator-state.yml`, condensed spec + plan), implements it, and stops — continue later with `/owflow:dev-verify` or stop there if the results are enough. Plan-only tasks work the same way: `/owflow:dev-plan --quick "<description>"` bootstraps a regular development task and stops after the plan — continue with `/owflow:dev-implement` or stop there if the plan is enough. Spec-only tasks condense one step further: `/owflow:dev-spec --quick "<description>"` bootstraps a regular development task and stops after the condensed specification (written directly on the fly, no specification-creator subagent; audit skipped) — continue with `/owflow:dev-plan` or stop there if the spec is enough.

**The `--quick` flag is optional.** You can start from a bare prompt with any quick-lane command — the skill bootstraps the task and then asks whether to run the condensed quick lane or escalate to the full pipeline. Pass `--quick` to skip that question and go straight to the quick lane. Invoked with no argument at all, the skill prompts you for a task description, task path, or identifier. Bug-shaped descriptions route to `/owflow:dev-bugfix` instead (you can insist on proceeding if you prefer).

```bash
# Quick lane, no questions asked
/owflow:dev-spec --quick "Add server-side pagination to the users list"
/owflow:dev-plan --quick "Add rate limiting to the public API"
/owflow:dev-implement --quick "Add a logout button to the navbar"

# Bare prompt — the skill asks: quick lane or full pipeline?
/owflow:dev-spec "Design the CSV export for the invoices table"
/owflow:dev-plan "Add rate limiting to the public API"
/owflow:dev-implement "Add CSV export to the invoices table"

# No argument — prompts for a description, task path, or identifier
/owflow:dev-spec
/owflow:dev-plan
/owflow:dev-implement
```

### Fine-Grained Control: Development Subskills

The full `/owflow:development` workflow consists of standalone subskills — `/owflow:dev-analyze`, `/owflow:dev-tdd-red`, `/owflow:dev-spec`, `/owflow:dev-plan`, `/owflow:dev-implement`, `/owflow:dev-verify`, `/owflow:dev-finalize` — which you can also invoke individually. Each accepts a task path, or just a task-directory identifier:

```bash
/owflow:dev-spec 2026-01-12-my-feature
/owflow:dev-verify .owflow/tasks/development/2026-01-12-my-feature
```

If a subskill is invoked too early in the workflow (prerequisite phases not yet complete), it stops and tells you exactly which steps to run first, in order. If the workflow state doesn't exist yet, use `/owflow:development <description>` to start from scratch.

### Fine-Grained Control: Performance Subskills

The full `/owflow:performance` workflow consists of standalone subskills — `/owflow:performance-analyze`, `/owflow:performance-spec`, `/owflow:performance-plan`, `/owflow:performance-implement`, `/owflow:performance-verify`, `/owflow:performance-finalize` — which you can also invoke individually. Each accepts a task path, or just a task-directory identifier:

```bash
/owflow:performance-analyze 2026-01-12-dashboard-queries
/owflow:performance-verify .owflow/tasks/performance/2026-01-12-dashboard-queries
```

If a subskill is invoked too early in the workflow (prerequisite steps not yet complete), it stops and tells you exactly which steps to run first, in order. If the workflow state doesn't exist yet, use `/owflow:performance <description>` to start from scratch.

## Standards-Aware Development

This is the key differentiator. Owflow doesn't just run workflows - it learns your project's conventions and enforces them:

- **`/owflow:flow-init`** scans config files, source code, and documentation to auto-detect your coding standards
- **Continuous checking** - standards are consulted before specification, during planning, and while coding (not just at the start)
- **`/owflow:standards-discover`** refreshes standards from your evolving codebase
- **`/owflow:standards-update`** lets you add or refine standards manually, or sync from another project with `--from=PATH`

Standards live in `.owflow/docs/standards/` and are indexed in `.owflow/docs/INDEX.md`.

**Important**: Do not use plan mode with workflows (see [Best Practices](#best-practices) below).

## User Hooks

Extend OpenCode's lifecycle with your project's own scripts. Drop hook scripts into `.owflow/hooks/` and owflow dispatches them through its hook handlers - no plugin code required.

Script names map to events: the kebab-case filename stem becomes the dotted event name (`tool-execute-before.sh` → `tool.execute.before`), and the extension selects the interpreter:

| Extension | Runner | Transport |
| --------- | ------ | --------- |
| `.ts`, `.js` | in-process (`import()`, default export `async (envelope) => result`) | envelope in, result returned |
| `.sh` | subprocess via `bash` | envelope on stdin, JSON result on stdout |
| `.ps1` | subprocess via `pwsh`/`powershell.exe` | envelope on stdin, JSON result on stdout |

Each event is either a **gate** or an **observe** event. Gate hooks (13 events, including `tool.execute.before`, `chat.message`, and `experimental.session.compacting`) can block or rewrite the operation; a `blocked` outcome rejects the operation and a `failed` outcome both rejects it and ends the current session, always with a `Blocked:` error and an actionable `Hint:`. Observe hooks (`config`, `event`, `dispose`) can never break the session - their failures are logged with the `[owflow]` prefix and ignored.

The wrapper and your scripts exchange one JSON envelope, `owflow-hooks/1`: the wrapper sends `{ protocol, event, class, session?, context }`; a script returns `{ protocol, status: "ok" | "blocked" | "failed", reason?, mutations? }`, where `mutations` may only touch the event's whitelisted fields (e.g. `args` for `tool.execute.before`). The full schema, event table, ordering rules, and mutation whitelist live in the [user hooks reference](.owflow/docs/project/user-hooks.md).

### Example hook in every format

The same logging hook - it records the event, session, tool, and command from the envelope - written in each supported format. Save **one** of these as `.owflow/hooks/tool-execute-before.<ext>`; the same hook name may not exist in two formats.

In-process scripts log with `console.log` to OpenCode's process output. Subprocess scripts cannot log to stdout (that channel is reserved for the result envelope), so the Bash and PowerShell examples append to `.owflow/hook-events.log` instead; their working directory is the project root. Keep log files outside `.owflow/hooks/` - the strict digest allows only hook scripts there.

**TypeScript** (`.owflow/hooks/tool-execute-before.ts`):

```ts
type Envelope = {
  event: string;
  session?: { sessionID: string };
  context: { tool?: string; args?: { command?: string } };
};

export default async (envelope: Envelope) => {
  const { tool, args } = envelope.context;
  const session = envelope.session?.sessionID ?? "unknown";
  console.log(
    `[example-hook] ${envelope.event} session=${session} tool=${tool ?? "?"} command=${args?.command ?? ""}`,
  );
  return { protocol: "owflow-hooks/1", status: "ok" };
};
```

**JavaScript** (`.owflow/hooks/tool-execute-before.js`):

```js
export default async (envelope) => {
  const { event, session, context } = envelope;
  console.log(
    `[example-hook] ${event} session=${session?.sessionID ?? "unknown"} tool=${context.tool ?? "?"} command=${context.args?.command ?? ""}`,
  );
  return { protocol: "owflow-hooks/1", status: "ok" };
};
```

**Bash** (`.owflow/hooks/tool-execute-before.sh`, uses `jq`):

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

**PowerShell** (`.owflow/hooks/tool-execute-before.ps1`):

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

> **Strict digest - important**: `.owflow/hooks/` may contain **only** hook scripts, and each hook name may appear in **exactly one** format (`.ts`, `.js`, `.sh`, or `.ps1` - never two files with the same stem). Any other entry - a directory, a `.md` readme, a dotfile - is a fatal registration error that drops the entire owflow plugin (including the destructive-command guard) until you fix or remove the file. Keep notes and fixtures elsewhere.

Hooks are digested once at startup: **restart OpenCode to reload** after adding, editing, or removing a script (there is no watcher). Registration is fail-fast - a broken gate hook blocks the operation when it fires, it is never silently skipped; a `failed` gate also ends the current session. To start with user hooks disabled, set `OWFLOW_HOOKS_DISABLED=1`; the two built-in hooks (destructive-command guard and post-compaction reminder) remain active.

**Trust model**: scripts are the host project's own code, executed with the user's full privileges, with inherited environment, no name/path validation, no timeouts, no output caps, no audit trail — the git-hooks/husky convention; the bypass switch is the only control.

**Visibility surfaces** (the loaded hook set is "effective after next restart"; TUI runtime colors are live):

- Startup: the `[owflow]` banner logs every registered hook (`path -> event [class] interpreter - status`), invalid entries, and the bypass state
- CLI: `owflow-hooks` prints a table (or `--json`), scanning `./.owflow/hooks/` relative to the current directory; it exits 1 when invalid entries are found. The CLI runs on `bun` (same runtime as OpenCode), so it needs `bun` on your PATH
- TUI: an always-on **Active hooks** panel in the right-hand sidebar lists every loaded hook by name - no command, session, message, or model turn required. Each row uses a colored status orb (like the MCP status in OpenCode): grey before the hook has run, yellow while it is running, green after a successful run, and red after a failed, blocked, or unavailable-interpreter run. The current state follows the hook name in muted grey as `Idle`, `Running`, `Success`, or `Error`. The dispatcher writes a single overwritten JSON snapshot to OpenCode's tmp directory (`owflow-hooks-<workspace-hash>.json` inside `os.tmpdir()/opencode/`) - one file per workspace, no per-run files, last writer wins. The file is a diagnostic bridge for the TUI; hook scripts and the `owflow-hooks/1` contract are unchanged. Set `OWFLOW_HOOKS_STATUS_FILE` only to override the path for tests or manual debugging.

The CLI and TUI scans are **structural only** - they validate names, extensions, and event derivations but do not import `.ts`/`.js` scripts. A hook that is structurally valid but throws at import (or lacks a default export) still appears as `registered` there; import validation happens exclusively at plugin startup, where one bad file is fatal. The startup banner is the surface that reflects the import-validated set.

PowerShell (`.ps1`) is verified against the same subprocess contract as `.sh` (envelope in, result JSON out, fail-closed mapping). The CLI and the startup banner remain the unconditional visibility fallbacks outside the TUI.

## Beta Channel

Want to try experimental features before they hit stable? Install from the beta channel:

TBD

## Best Practices

**Don't use plan mode when starting a workflow.** Planning is a built-in part of every workflow — the orchestrator creates specs, plans, and other files as it goes. OpenCode's plan mode restricts file creation, which conflicts with this. Let the workflow handle planning on its own.

**Start workflows in a fresh session.** This is especially useful when chaining workflows (e.g., research → development). Research artifacts already contain all the context needed, so a clean session avoids noise from prior conversation.

**Chain workflows by passing a task folder.** If you've completed a research workflow and want to build on those results, pass the task folder directly — by path, or just by its directory identifier if the name is unique:

```bash
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research
```

You can also append additional instructions to narrow scope or guide the workflow:

```bash
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research Implement only phase 1
```

**Fork a research task to diverge from it.** If you want to re-run part of a completed research with different choices while keeping the original intact, fork it. Passing the task path is enough — the skill reads that research, then asks what the fork should explore, where it should diverge, and what to call it, with suggestions drawn from the research itself:

```bash
/owflow:research-fork .owflow/tasks/research/2026-01-12-oauth-research
```

Answer the three questions (or supply the answers up front — each one then gets skipped):

```bash
/owflow:research-fork .owflow/tasks/research/2026-01-12-oauth-research "compare scoping alternatives" \
  --from=synthesis-complete --name="compare-scoping-alternatives"
```

The copy is verbatim (all artifacts, including those from after the fork point) and only the fork's `completed_phases` is trimmed at the fork point, so the fork resumes at the step after it. The source task is never modified.

## Known Issues

**Orchestrator may stall after long phases.** After context compaction (which typically happens after lengthy phases like implementation), the main agent may stop progressing automatically. If you notice it's idle, just type something like "continue" or "proceed" — it will pick up where it left off. You can also re-invoke the workflow in resume mode to reload the orchestrator state:

```bash
/owflow:development .owflow/tasks/development/2026-03-24-my-feature
```

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
