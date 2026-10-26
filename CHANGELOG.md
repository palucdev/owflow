# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Event-named hook files** — `.owflow/hooks/` now accepts filenames that derive to a v1 host event (`session-idle.sh` → `session.idle`). The single `event` handler fans out to the matching observer, so the script fires only for that event type without parsing the envelope; accepted names are pinned to the v1 `Event` union (32 events), and v2-only `session.next.*` names stay rejected. The bundled build hook is now `session-idle.sh`.
- **Hook runtime logs and click-to-open popup** — every user-hook fire now appends records to a per-workspace JSONL file in OpenCode's tmp directory (`owflow-hook-logs-<workspace-hash>.jsonl`). Hooks capture stderr, exit code, and signal automatically; valid stdout remains exclusively the `owflow-hooks/1` result and is stored raw only when malformed. Captured output is never forwarded to OpenCode's process output — the log file and popup are the only surfaces. Records are capped at 16 KB per stream and 32 KB each, the file at 4 MB with a single `.1` rotation, and all I/O is best-effort. Clicking an Active hooks row opens a centered run-detail popup with the latest run's status, duration, reason, exit code/signal, and session; its **View logs** button opens a second popup with the captured output. The popup follows the same session epoch as the row status: runs that started before the session's panel opened are ignored, so a fresh session shows an info toast instead of replaying the previous process's last record. A hook with no recorded run shows an info toast. `OWFLOW_HOOK_LOGS_FILE` overrides the path for tests and debugging. Logs are local-only and unredacted; the dispatch envelope and prompt/tool content are never captured.
- **Live hook runtime status in the TUI** — each Active hooks row uses a colored status orb (`•`, like the OpenCode MCP status) that starts grey, turns yellow while a hook runs, green after a fire with visible output, and red after a failure, block, or unavailable interpreter; a settled outcome stays until that hook fires again. Every hook reports `In progress` while its code runs; only a silent successful catch-all `event` run clears that state without recording an outcome, returning the row to its previous state (or `Idle`). Event-named hooks and the one-shot `config`/`dispose` hooks record silent successes too. A session's panel ignores runs from before that panel opened, so every new session starts fully `Idle` (including the high-frequency `event` hook) and lights a row only on a real fire. The state is repeated after the hook name in muted grey as `Idle`, `In progress`, `Success`, or `Error`. Openable rows end with a muted `›` and highlight with the theme's primary color on hover. The dispatcher writes one overwritten JSON snapshot per workspace to OpenCode's tmp directory (`owflow-hooks-<workspace-hash>.json`), reusing one `.tmp` name and flushing at most every 50 ms; hook scripts and the `owflow-hooks/1` contract are unchanged. `OWFLOW_HOOKS_STATUS_FILE` overrides the path for tests and debugging.

### Removed

- **In-process user hooks** — `.ts`/`.js` hook scripts are no longer supported; `.owflow/hooks/` now accepts only `.sh` and `.ps1` subprocess scripts. The in-process runner, module-import validation, the AsyncLocalStorage console-capture machinery, late-output capture, and the `runnerClass`/`errorStack` log fields are removed. Existing `.ts`/`.js` hooks fail the strict digest at startup with a recovery hint; port them to `.sh`/`.ps1`, remove them, or set `OWFLOW_HOOKS_DISABLED=1`. Old JSONL log records remain readable.

### Changed

- **Silent catch-all `event` runs are no-ops** — a catch-all `event` run that returns `ok` without capturing any stdout/stderr reports `In progress` while it runs, then clears that state without recording a terminal outcome and writes no runtime-log record. This keeps the high-frequency `event` hook from lighting up on every host event it is invoked for. Event-named hooks (`session-idle`, ...) and the one-shot `config`/`dispose` hooks are recorded like any other script even when they capture nothing, so a silent build success still shows a green `Success` row and a log record with no captured output; failures and runs with output keep the full `In progress`/`Success`/`Error` lifecycle.

## [0.7.0] - 2026-10-12

### Added

- **User hooks wrapper** — host projects can drop scripts into `.owflow/hooks/` and have owflow dispatch them through its lifecycle handlers, no plugin code required. The kebab-case filename stem maps mechanically to the dotted event name (`tool-execute-before.sh` → `tool.execute.before`), and the extension selects the runner: `.ts`/`.js` in-process via `import()`, `.sh` via `bash`, `.ps1` via `pwsh`/`powershell.exe`.
- Uniform versioned `owflow-hooks/1` JSON envelope (stdin/stdout) for every script type, with a per-event mutation whitelist derived from the host `Hooks` output types.
- Per-event gate/observe semantics: 13 gate events translate any non-`ok` outcome to a fail-closed `Blocked:` error with an actionable `Hint:`; a `failed` gate also ends the current session, while `blocked` only rejects the operation. The 3 observe events (`config`, `event`, `dispose`) log with the `[owflow]` prefix and never break the session.
- `owflow-hooks` CLI (new bin) — standalone would-load scan of `./.owflow/hooks/` with a table default and `--json` output; exits 1 when invalid entries are found. Requires `bun` on `PATH`.
- **TUI Active hooks panel** (new `./tui` entry) — an always-on right-hand sidebar panel listing `Active hooks:` and one `- <name>` line per loaded hook, with no command, session, message, or model turn.
- `OWFLOW_HOOKS_DISABLED=1` bypass — user hooks off, the two built-in hooks (destructive-command guard, post-compaction reminder) stay active.

### Changed

- `package.json`: new `owflow-hooks` bin and an `exports` map (`"."` server entry, `"./tui"` TUI entry).
- Hook model centralized: event names are `HookEvent` enum values, all hook types/contracts live in `src/types/hook-types.ts`, and `.owflow` directory names live in `src/utils/workflow-paths.ts` and are referenced across the plugin.
- Server hook wiring moved out of `src/index.ts` into `src/hooks/plugin-hooks.ts`.
- Documentation: README "User Hooks" section, `.owflow/docs/project/user-hooks.md` reference page (INDEX-registered), and an AGENTS.md Hooks section covering the dispatch layer.

### Fixed

- **One format per hook name** — a duplicate stem (for example `check.ts` plus `check.sh`) is now a fatal digest error; each hook name registers exactly once.
- **Failed gates stop the session** — a gate returning `failed` (or missing its interpreter) now aborts the current session in addition to rejecting the operation.
- **Persistent TUI visibility** — the one-shot toast was replaced by the always-on sidebar panel, so loaded hooks are visible without invoking a command.

### Notes

- **Strict digest** — `.owflow/hooks/` may contain only hook scripts, one file per hook name: any other entry (directory, `.md` readme, dotfile) or duplicate name is a fatal registration error that drops the entire owflow plugin, including the destructive-command guard. Notes and fixtures belong elsewhere.
- **Baseline trust** — scripts are the host project's own code, executed with the user's full privileges: inherited environment, no name/path validation, no timeouts, no output caps, no audit trail (the git-hooks/husky convention); the bypass switch is the only control.
- Hooks are digested once at plugin startup — **restart OpenCode to reload** (there is no watcher). Registration is fail-fast; a broken gate hook blocks the operation when it fires and is never silently skipped.
- PowerShell (`.ps1`) parity is verified against the same subprocess contract as `.sh`; the TUI panel is covered by the TUI test suite. The CLI and the startup banner remain the unconditional visibility fallbacks outside the TUI.
- Zero new runtime dependencies; the execution core is deliberately platform-agnostic behind an internal `run(entry, envelope) → Outcome` seam, prepared for the staged OpenCode v2 port.

## [0.6.1] - 2026-10-08

### Added

- `diagrams-mermaid` theming: ready-to-paste `github-dark` (default) and `github-light` Mermaid theme directives with exact palettes, copied from the Pretty-mermaid-skills theme-gallery SVGs (palette variables plus the SVG's derived node-fill, node-stroke, and group tints).

### Changed

- `diagrams-mermaid` is now file-first: diagrams are written into the target artifact file (chat-only only on explicit opt-in and marked `Not persisted`), all labels must be traceable to context, and Mermaid C4 support was removed in favor of flowchart-plus-subgraph architecture views.
- Integration sites (`dev-spec`, `research-design`, `flow-init`) pass the target file explicitly and use the flowchart architecture-view guidance.
- `docs/commands.md`: `/owflow:diagrams-mermaid` description updated to the new skill contract.
- All Mermaid diagrams in the repository were regenerated; legacy Mermaid C4 diagrams became flowchart-plus-subgraph architecture views, and duplicated diagrams were replaced with pointer references to their canonical artifacts.

## [0.6.0] - 2026-10-05

### Added

- Standalone performance subskills: `performance-analyze`, `performance-spec`, `performance-plan`, `performance-implement`, `performance-verify`, and `performance-finalize`, plus the `goal-performance` autonomous wrapper — the performance workflow now mirrors the development/research subskill family.
- Performance state vocabulary re-keyed to nine descriptive step slugs (`codebase-analysed`, `bottlenecks-identified`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `options-chosen`, `verification-done`, `task-completed`), migrated template-first.
- Performance bootstrap subsection in the shared Gate Contract; relocated `performance-optimization-guide.md` into `performance-analyze/references/`.

### Changed

- `owflow:performance` rewritten as a routing-only dispatcher (437 → 267 lines) that hands off to the subskills one step per invocation.
- Documentation surface (AGENTS.md, docs/, README, work command) synced to the split.

### Notes

- Pre-split performance tasks carrying `phase-N` state are not resumable; restart them via `/owflow:performance <description>`.

## [0.5.0] - 2026-10-05

### Added

- Standalone migration subskills: `migration-analyze`, `migration-target`, `migration-spec`, `migration-plan`, `migration-implement`, `migration-verify`, `migration-fix`, and `migration-finalize`, plus the `goal-migration` autonomous wrapper — the migration workflow now mirrors the development/research subskill family.
- Migration state vocabulary re-keyed to descriptive step slugs (`state-analysed`, `target-planned`, `strategy-specified`, `plan-created`, `migration-executed`, `options-chosen`, `verification-done`, `issues-resolved`, `docs-generated`, `task-completed`), with a `migration-binding-proof` fixture guarding the template.
- `fix-loop-contract` reference: verification issues run a max-3 fix-then-reverify loop, while data-integrity failures HALT and are never auto-fixed.
- Project documentation under `.owflow/docs/` (vision, roadmap, tech-stack, architecture, workflow-design standards).

### Changed

- `owflow:migration` rewritten as a routing-only dispatcher that hands off to the subskills one step per invocation; rollback planning is mandatory and every task group in the plan carries a rollback/checkpoint step, with `migration-target` owning the risk-lock boundary.
- Documentation surface (README, AGENTS.md, `docs/commands.md`, `docs/workflows.md`) synced to the split and step vocabulary.

## [0.4.3] - 2026-09-30

### Changed

- Commands are now generated dynamically from skills declaring `user-invocable: true`; 30 hand-maintained command wrappers were removed (dev-\*, research-\*, goal-\*, dispatchers, content skills), leaving only `work` and `reviews-*` as maintained command files.
- `commands-config` renders command templates from skill frontmatter and fails registration when a user-invocable skill is missing its `name`/`description` contract.
- `docs/commands.md` regenerated; AGENTS.md and README updated.

## [0.4.2] - 2026-09-29

### Added

- Standalone research subskills: `research-plan`, `research-gather`, `research-synthesize`, `research-brainstorm`, `research-converge`, `research-design`, `research-finalize`, `research-quick`, and `research-fork`, plus the `goal-research` autonomous wrapper.
- `research-fork` forking: a `fork_task` tool plus fork utilities that copy a task directory wholesale and trim state to the chosen fork point; `plugin-info` and `yaml-structure` utilities.
- Research state template expanded (entry point, decision areas, outputs) with fork/plugin-info tests and research verify-template fixtures.

### Changed

- `owflow:research` rewritten as a routing-only dispatcher that hands off one step per invocation; research agents (information-gatherer, research-planner, research-synthesizer, solution-\*) aligned to the subskill pipeline, with the Gate Contract and dispatcher-handoff references extended for subskill handoffs.

## [0.3.0] - 2026-09-25

### Added

- Development subskills: `dev-analyze`, `dev-tdd-red`, `dev-spec`, `dev-plan`, `dev-implement`, `dev-verify`, `dev-finalize`, and `dev-bugfix`, plus the `goal-development` autonomous wrapper and the shared Gate Contract.
- `agents-md-generator` and `rule-reviewer` skills and commands.
- Orchestrator framework references: delegation rules, dispatcher handoff, confirm-or-revise exception, and command namespacing.
- VS Code workspace settings for namespaced skill names.

### Changed

- `owflow:development` rewritten as a routing-only dispatcher; quick lanes folded into subskills (`quick-dev` → `dev-implement --quick`, `quick-plan` → `dev-plan --quick`, `quick-bugfix` → `dev-bugfix`).
- All skills and commands prefixed `owflow:`; migration, performance, research, and standards skills aligned to the subskill vocabulary; AGENTS.md condensed and README, `docs/commands.md`, `docs/workflows.md` updated.

### Removed

- `quick-bugfix` skill plus the `quick-dev`, `quick-plan`, and `quick-bugfix` command wrappers and their state templates.

### Fixed

- Dependency security patch.

## [0.2.0] - 2026-07-30

### Added

- Configuration modules (`agents-config`, `commands-config`, `skills-config`), `constants`, and `file-util`.
- Lifecycle hooks: destructive-command protection (`tool.execute.before`) and post-compaction state reminder, both covered by tests.
- Bun test setup (`bunfig.toml`) with unit tests for configuration, hooks, index, and template verification.

### Changed

- `index.ts` slimmed down by moving the plugin body into modules; template verification tests reorganized; package/tsconfig cleanup; README expanded.

## [0.1.10] - 2026-07-21

### Fixed

- Publishing errors: moved `@opencode-ai/plugin` to runtime dependencies, dropped the stale `module` field, and added simple installation logging.

## [0.1.9] - 2026-07-21

### Fixed

- ESM publishing: added the `exports` entry, `.js` import specifiers, `NodeNext` module resolution, and the `yaml` dependency.

## [0.1.8] - 2026-07-21

### Fixed

- Restored `npm run build` as the prepack step so publishing works under npm.

## [0.1.7] - 2026-07-21

### Changed

- Bumped `@opencode-ai/plugin` to 1.18.4.

## [0.1.6] - 2026-07-21

### Added

- Centralized orchestrator-state templates under `src/templates/` and the `verify_template` tool for programmatic template validation.
- Quick commands (`quick-dev`, `quick-plan`, `quick-bugfix`) now anchor artifacts in lightweight task directories with `task.yml`/`summary.md`.

### Changed

- Build scripts routed via bun; performance and research skill wording updated.

### Removed

- The `product-design` skill, its server, and its references.

## [0.1.5] - 2026-05-14

### Added

- `diagrams-mermaid` skill (Mermaid diagrams for planning, communication, and architecture views) and `html-renderer` skill (self-contained share-ready HTML from markdown plans), with commands and reference assets.
- Mermaid/HTML spec support wired into the development, flow-init, migration, performance, and research skills.

## [0.1.4] - 2026-05-11

### Changed

- OpenCode compatibility: removed Claude/Claude Code-specific phrasing and renamed `claude-md-template.md` to `agents-md-template.md`.
- Expanded migration strategies/types references; cleaned up quick-plan, docs-manager, and e2e-verifier flows.

## [0.1.3] - 2026-05-11

### Fixed

- `PLUGIN_ROOT` now resolves to `dist/` (where skills/commands/agents markdown is copied), fixing template loading.
- Named-export plugin loading; the plugin now default-exports `OwflowPlugin`.

## [0.1.2] - 2026-05-10

### Added

- Installation guide in the README.
- `copy-markdowns` build script shipping skills/commands/agents markdown into `dist/`.

### Fixed

- OpenCode runtime problems; `gray-matter` moved to runtime dependencies and the build wired to `prepack`.

## [0.1.1] - 2026-05-10

### Changed

- npm publishing preparation: fixed the `main` path, added `types`, and enabled build-on-publish (`prepublishOnly`).

## [0.1.0] - 2026-05-10

### Added

- Initial release, forked from the Maister Claude Code plugin for OpenCode: development, migration, performance, research, and product-design workflows; 24 specialized agents; `flow-init` project documentation and standards generation; standards discovery/update; review commands; and the `quick-dev`, `quick-plan`, and `quick-bugfix` lanes.
