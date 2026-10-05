# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-10-05

### Added

- Standalone performance subskills: `performance-analyze`, `performance-spec`, `performance-plan`, `performance-implement`, `performance-verify`, and `performance-finalize`, plus the `goal-performance` autonomous wrapper — the performance workflow now mirrors the development/research subskill family.
- Performance state vocabulary re-keyed to nine descriptive step slugs (`codebase-analysed`, `bottlenecks-identified`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `options-chosen`, `verification-done`, `task-completed`), migrated template-first.
- Performance bootstrap subsection in the shared Gate Contract; relocated `performance-optimization-guide.md` into `performance-analyze/references/`.

### Changed

- `owflow:performance` rewritten as a routing-only dispatcher (437 → 267 lines) that hands off to the subskills one step per invocation.
- Commands/config test surface extended with a performance vocabulary & binding guard and a `performance-binding-proof` fixture.
- Documentation surface (AGENTS.md, docs/, README, work command) synced to the split.

### Notes

- Pre-split performance tasks carrying `phase-N` state are not resumable; restart them via `/owflow:performance <description>`. See the upgrade note in `docs/workflows.md` (Performance → Resume).

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
