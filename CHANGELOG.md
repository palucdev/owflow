# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-11-13

### Added

- **ESLint configuration (`eslint.config.mjs`)** — Added strict Flat Config setup for TypeScript/JavaScript with `typescript-eslint`, `@eslint/js`, `eslint-plugin-sonarjs`, `eslint-plugin-unicorn`, and `eslint-plugin-security`. Configured rules enforcing architectural constraints, code quality, and maintainability:
  - Architecture: Forbidden direct `process.env` access via `no-restricted-syntax` to mandate dependency injection.
  - Maintainability & complexity: `max-params` (2), `max-lines-per-function` (50), `max-lines` (250), `complexity` (10), `max-depth` (4), `max-statements` (20), `max-classes-per-file` (1).
  - Code hygiene: `id-length` (min 2, exception `_`), strict equality (`eqeqeq: always`), and `@typescript-eslint/no-magic-numbers` (ignoring 0, 1, -1).
- **ESLint npm scripts** — Added `"lint"` (`eslint .`), `"lint:fix"` (`eslint . --fix`), and `"lint:file"` (`eslint`) scripts to `package.json`.
- **Config protection hook (`.owflow/hooks/tool-execute-before.sh`)** — Lifecycle guard hook blocking tool calls (`edit`, `write`, `bash`) from modifying or deleting `eslint.config.mjs`.
- **Automated per-file linting hook (`.owflow/hooks/tool-execute-after.sh`)** — Post-execution hook that automatically lints modified source files (`.ts`, `.tsx`, `.js`, etc.) using Bun/ESLint with stateful attempt tracking (`/tmp/owflow-lint-state-*.json`), prompting fixes on attempts 1–2 and halting with a critical escalation to the user on attempt 3.

## [0.7.0] - 2026-11-13

### Added

- **User hooks wrapper (`.owflow/hooks/`)** — host projects can drop `.sh` (`bash`) and `.ps1` (`pwsh`/`powershell.exe`) subprocess scripts into `.owflow/hooks/` and have owflow dispatch them through its lifecycle handlers (guard-first on `tool.execute.before`), with no plugin code required. The kebab-case filename stem maps mechanically to the dotted event name (`tool-execute-before.sh` → `tool.execute.before`).
- **PowerShell execution flags** — Subprocess execution for `.ps1` hooks automatically injects `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, preventing profile load latency, interactive prompt deadlocks, and execution policy blocks.
- **Event-named host event hooks** — `.owflow/hooks/` also accepts filenames that derive to a v1 host event (`session-idle.sh` → `session.idle`). The single `event` handler fans out to the matching observer, so the script fires only for that event type without parsing the envelope; accepted names are pinned to the v1 `Event` union (32 events), and v2-only `session.next.*` names stay rejected.
- **Subprocess stdin JSON payload** — structured stdin payload containing event, session, and context passed to hook subprocesses. Host class instances inside context are stripped to identity keys (`id`, `sessionID`, `messageID`, `partID`, `callID`, `providerID`, `type`, `name`, `tool`).
- **Fail-closed gate semantics and error guidance** — Lifecycle gate events translate non-zero exits, timeouts, and missing interpreters to a `Blocked:` error with an actionable `Hint:`. Active lifecycle gate events abort the current session to halt execution, while reactive host events fail closed without session aborts to avoid recursive loops. Bounded error summaries restrict first-line error messages to 200 characters with links to the TUI log viewer.
- **Live hook runtime status in the TUI** (new `./tui` entry) — an always-on **Active hooks** right-hand sidebar panel displays each loaded hook with a colored status orb (`•`): grey (`Idle`), yellow (`In progress`), green (`Success`), and red (`Error`). The dispatcher writes a single atomically overwritten JSON snapshot per workspace (`owflow-hooks-<workspace-hash>.json`, mode `0o600`, 50 ms trailing flush, overrideable via `OWFLOW_HOOKS_STATUS_FILE`). Silent successful catch-all `event` runs clear their pending state without recording a terminal outcome, while event-named and `config`/`dispose` hooks record silent successes too.
- **Isolated per-hook runtime logs and click-to-open TUI popups** — Settled runs append bounded records to isolated per-hook JSONL files (`owflow-hook-logs-<workspace-hash>-<hook-name>.jsonl`, mode `0o600`, 4 MB single-file `.1` rotation, overrideable via `OWFLOW_HOOK_LOGS_FILE`), preventing high-frequency hooks from evicting lower-frequency hook logs. A workspace-scoped symlink (`owflow-hooks-latest-<workspace-hash>.jsonl`) links to the most recently written hook log file. Clicking a hook row in the TUI opens a run-detail popup for the current session's latest run with a **View logs** button for captured stderr/stdout.
- **Session-scoped non-truncated hook logs with lazy-loaded scrolling** — Hook outputs in active sessions are preserved in full without stream truncation (non-session runs remain capped at 16 KB per stream), and displayed in the TUI logs popup with incremental lazy-loading as the user scrolls. Multiple runs within a session are grouped and viewable across the session lifecycle.
- **Bounded tail log reader with mtime caching** — `readHookLogRecords` bounds reads to the trailing 256 KB slice (`MAX_LOG_TAIL_READ_BYTES`) via file descriptors (`O_RDONLY | O_NOFOLLOW`), discarding leading partial lines and caching parsed records by file modification time and size to eliminate synchronous full-file I/O on the UI thread.
- **Subprocess lifecycle and bypass controls** — `OWFLOW_HOOKS_DISABLED=1` bypasses user hooks while keeping built-in hooks active; optional `OWFLOW_HOOK_TIMEOUT_MS` terminates hung hook subprocesses and maps them to `failed`; in-flight child processes are tracked and terminated on plugin `dispose()`.
- **Prettier code formatting** — Added Prettier configuration (`.prettierrc`, `.prettierignore`) and a `bun run prettify` script.

### Changed

- **Universal gate hooks (breaking change)** — Simplified user hooks subsystem to universal gate hooks. Removed the `observe` class, `HookClass` type, and `skipped-no-interpreter` status. All 16 lifecycle events and 32 host events now fail closed on non-`ok` (`blocked` / `failed`) outcomes and when interpreters are missing.
- **Modular runtime decomposition** — Decomposed hooks runtime into specialized modules under `src/hooks/runtime/` (`circuit-breaker.ts`, `failure-policy.ts`, `process-executor.ts`, `status-recorder.ts`), orchestrated by `HooksWrapper` (`src/hooks/hooks-wrapper.ts`).
- **Fail-closed `config` hook** — `config` hook failures and gate rejections now propagate and reject plugin initialization instead of being swallowed with warnings.
- **Fail-closed host event hooks with loop protection** — Host event hooks (`session.idle`, etc.) and the catch-all `event` hook fail closed (`Blocked:` error and failure recorded in TUI/logs) without aborting active sessions, avoiding recursive state loops. Includes a 30s circuit breaker (tripping after 4 rapid failures with <= 500ms gaps), in-flight event deduplication, and a 2s per-session abort cooldown on gate hooks.
- **Debounced and atomic status persistence** — Transient `PENDING` status transitions are debounced by 50ms via `.unref()` timers to eliminate disk thrashing during rapid executions, while terminal states (`SUCCESS`/`FAILURE`) and plugin shutdown flush immediately using atomic temporary file renames.
- **Four-column startup banner** — Startup banners use 4 columns (`path`, `event`, `interpreter`, `status`), removing the redundant `class` column. Gated to log once on startup and suppressed during configuration hot reloads.
- **Subagent model inheritance cleanup** — Pruned redundant `model: inherit` declarations across all 23 internal subagents in `src/agents/*.md`, relying on standard OpenCode model inheritance defaults.
- `package.json`: dual `exports` map (`"."` server entry and `"./tui"` TUI entry with emitted `.d.ts` declarations), repository metadata, and updated `engines` (`node >= 22`, `bun >= 1.3.0`).
- Hook model centralized: event names are `HookEvent` enum values, all hook types/contracts live in `src/types/hook-types.ts`, and `.owflow` directory names live in `src/utils/workflow-paths.ts` and are referenced across the plugin.
- Server hook wiring moved out of `src/index.ts` into `src/hooks/hooks-wrapper.ts`; `agentBySession` is bounded to 256 sessions.
- Documentation: README "User Hooks" and "Environment Variables" sections, `.owflow/docs/project/user-hooks.md` reference page (INDEX-registered), and an AGENTS.md Hooks section covering the dispatch layer and persistence architecture.

### Fixed

- **Subagent visibility in OpenCode (`hidden` boolean parsing)** — Fixed boolean evaluation for `hidden: true` in `agents-config.ts` and `subtask: true` in `commands-config.ts` so native YAML booleans from markdown frontmatter are properly recognized instead of comparing against string `'true'`.
- **Log deduplication data loss in session runs** — Replaced categorical deduplication in `appendLog` with bounded `runId:status` tracking (1,000 entries), ensuring consecutive tool calls and identical runs in a session are all preserved in the JSONL audit trail and accurately reflected in TUI run counters.
- **Multi-workspace symlink collision** — Scoped the latest log symlink to `owflow-hooks-latest-<workspace-hash>.jsonl`, preventing race conditions and file handle hijacking when running multiple OpenCode workspaces concurrently.
- **Concurrent status file collisions** — Generated cryptographically unique temporary filenames (`<file>.<pid>.<uuid>.tmp`) during atomic status snapshot writes, preventing file truncation and rename collisions when async dispatches flush status simultaneously.
- **TOCTOU symlink race in log appending** — Switched `appendWithRotation` to use `fs.openSync` with `O_NOFOLLOW` and append via file descriptor, preventing symlink redirection attacks in shared temporary directories.
- **Terminal output leakage into OpenCode TUI** — Eliminated console/stderr dumping of hook errors, test traces, and hot-reload banners by routing runtime failures to persistent crash logs (`owflow-hooks-crash.log`) and gating config banners.
- **TUI sidebar memory leak** — Registered Solid `onCleanup` hooks to unregister and garbage-collect sidebar handles upon unmount, preventing handle accumulation across render cycles.
- **Unbounded memory retention in session maps** — Added LRU capacity caps to in-memory maps for circuit breakers, session abort controllers, and TUI session epochs.
- **Path traversal in `verify_template`** — Hardened template verification against directory traversal by validating safe basename boundaries against the templates directory.

### Notes

- **Strict digest** — `.owflow/hooks/` may contain only `.sh` and `.ps1` hook scripts, one file per hook name: any other entry (directory, symlink, `.md` readme, dotfile, or unsupported extension) or duplicate stem fails validation, bypassing user hooks while the built-in destructive-command guard remains active, until resolved or bypassed via `OWFLOW_HOOKS_DISABLED=1`. Notes and fixtures belong elsewhere.
- **Baseline trust** — scripts are the host project's own code, executed with the user's full privileges and inherited environment (the git-hooks/husky convention); `OWFLOW_HOOKS_DISABLED=1` and opt-in `OWFLOW_HOOK_TIMEOUT_MS` are the operator controls.
- **Restart to reload** — hooks are digested once at plugin startup (there is no file watcher). Registration is fail-fast; a broken gate hook blocks the operation when it fires and is never silently skipped.
- **Transitive dependency audit** — `bun audit` reports 4 high-severity advisories on transitive dependencies (`toml@4.2.0` and `zod@4.1.8` pulled in by `@opencode-ai/plugin@^1.18.4`); neither package is imported or reachable by owflow's own code, and resolution is tracked upstream in `@opencode-ai/plugin`.
- Zero new runtime dependencies; the execution core is platform-agnostic behind an internal `HooksWrapper` dispatch seam, prepared for the staged OpenCode v2 port.

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
