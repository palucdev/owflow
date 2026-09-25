# Command Reference

## Unified Entry Point

### `/work [input]`

Auto-classifies your task and routes to the appropriate workflow. Accepts:

- **No arguments**: Extracts the task from your current conversation context
- Task description: `/work "Add user profile page"`
- Task folder path: `/work .owflow/tasks/new-features/2026-02-17-user-profile` (resumes)
- GitHub issue URL: `/work https://github.com/org/repo/issues/42`

The plugin classifies the task type with confidence scoring, asks for confirmation, then launches the matching orchestrator.

---

## Development

### `/development [description | task-path]`

Starts the unified development workflow (14 adaptive phases) or resumes an existing one. All arguments are optional — when run without a description, the plugin extracts it from your current conversation. Pass an existing task path to resume. Task type (bug/enhancement/feature) is auto-detected from context when `--type` is omitted.

| Flag                               | Description                                             |
| ---------------------------------- | ------------------------------------------------------- |
| `--type=bug\|enhancement\|feature` | Specify task type (auto-detected if omitted)            |
| `--e2e`                            | Include E2E testing phase                               |
| `--user-docs`                      | Generate user documentation phase                       |
| `--code-review`                    | Include code review phase                               |
| `--research=PATH`                  | Start development informed by a completed research task |
| `--from=PHASE`                     | Start from or resume at a specific phase                |
| `--reset-attempts`                 | Reset failed attempt counters (resume)                  |

**Task directory**: `.owflow/tasks/development/`
**Resume phases**: `analysis`, `gap`, `spec`, `plan`, `implement`, `verify`

---

## Performance

### `/performance [description | task-path]`

Starts performance optimization with static bottleneck analysis (9 phases) or resumes an existing one. Can be run without arguments — the plugin extracts the optimization target from your conversation. Detects N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, and memory leak patterns.

| Flag               | Description                              |
| ------------------ | ---------------------------------------- |
| `--from=PHASE`     | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume)   |

You can optionally provide profiling data (flame graphs, APM screenshots) — the workflow creates a directory for these.

**Task directory**: `.owflow/tasks/performance/`
**Resume phases**: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

### `/migration [description | task-path]`

Starts migration workflow (8 phases) with mandatory rollback planning and risk assessment, or resumes an existing one. Can be run without arguments — the plugin extracts migration details from your conversation.

| Flag                                       | Description                              |
| ------------------------------------------ | ---------------------------------------- |
| `--type=code\|data\|architecture\|general` | Migration type (affects risk focus)      |
| `--from=PHASE`                             | Start from or resume at a specific phase |
| `--reset-attempts`                         | Reset failed attempt counters (resume)   |

**Task directory**: `.owflow/tasks/migrations/`
**Resume phases**: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

### `/research [question | task-path]`

Starts research workflow (8 phases) with multi-source gathering, synthesis, and optional solution brainstorming, or resumes an existing one. Can be run without arguments — the plugin extracts the research question from your conversation.

| Flag                                                | Description                              |
| --------------------------------------------------- | ---------------------------------------- |
| `--type=technical\|requirements\|literature\|mixed` | Research methodology type                |
| `--brainstorm`                                      | Force brainstorming + design phases      |
| `--no-brainstorm`                                   | Skip brainstorming phases                |
| `--from=PHASE`                                      | Start from or resume at a specific phase |
| `--reset-attempts`                                  | Reset failed attempt counters (resume)   |

Research output can feed into development: `/development --research=.owflow/tasks/research/...`

**Task directory**: `.owflow/tasks/research/`
**Resume phases**: `foundation`, `brainstorming-decision`, `brainstorming`, `design`, `outputs`, `verification`, `integration`

---

## Reviews & Audits

Standalone review commands that can be run anytime, independent of workflows.

### `/reviews-code [path]`

Automated code quality, security, and performance analysis.

| Flag                                          | Description                 |
| --------------------------------------------- | --------------------------- |
| `--scope=quality\|security\|performance\|all` | Focus area (default: `all`) |

Analyzes complexity, duplication, code smells, security vulnerabilities, and performance issues. Generates report with severity levels (Critical/Warning/Info).

### `/reviews-pragmatic [path]`

Detects over-engineering and ensures code matches project scale. Identifies excessive abstraction, enterprise patterns in simple code, infrastructure overkill. Recommends specific simplifications with before/after examples.

### `/reviews-reality-check [task-path]`

Validates that completed work actually solves the intended problem. Runs tests, checks end-to-end workflows, and evaluates error scenarios. Returns deployment decision: Ready / Issues Found / Not Ready.

### `/reviews-spec-audit [spec-path]`

Independent specification audit with senior auditor perspective.

| Flag                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `--post-implementation` | Compare spec vs actual implementation (default: pre-implementation) |

Identifies ambiguities, missing details, and gaps. Uses external tools (GitHub CLI, Azure CLI) for verification.

### `/reviews-production-readiness [path]`

Pre-deployment verification across 7 dimensions: configuration, monitoring, error handling, performance, security, deployment, and GO/NO-GO recommendation.

| Flag                     | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `--target=prod\|staging` | Target environment (default: `prod` with full rigor) |

---

## Standards

### `/flow-init [--standards-from=PATH]`

Initialize the Owflow framework. Scans your codebase with a project-analyzer subagent, presents findings for confirmation, then generates:

- `.owflow/docs/` with INDEX.md, project docs (vision, roadmap, tech-stack), and coding standards
- `.owflow/tasks/` directory structure
- AGENTS.md integration

| Flag                    | Description                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--standards-from=PATH` | Copy standards from another project's `.owflow/docs/standards/` instead of built-in defaults. Useful when starting a new project that should follow the same conventions as an existing one. |

If `.owflow/` already exists, offers to backup, update, or cancel.

### `/standards-discover [--scope=SCOPE]`

Auto-discovers coding standards from multiple sources in parallel: config files, source code patterns, documentation, pull requests, and CI/CD pipelines.

| Flag                                                      | Description                                         |
| --------------------------------------------------------- | --------------------------------------------------- |
| `--scope=full\|quick\|frontend\|backend\|testing\|custom` | Discovery scope (default: `full`)                   |
| `--confidence=N`                                          | Minimum confidence threshold, 0-100 (default: `60`) |
| `--auto-apply`                                            | Auto-apply standards with 90%+ confidence           |
| `--skip-external`                                         | Skip PR and CI/CD analysis                          |
| `--pr-count=N`                                            | Number of PRs to analyze (default: `10`, max: `20`) |

Presents findings in confidence tiers (high/medium/low) for review before applying.

### `/standards-update [description] [--from=PATH]`

Update or create standards from conversation context or explicit description. When run without arguments, scans your current conversation for standards patterns like "we should always...", "our convention is...", "prefer X over Y" and proposes them as new standards.

| Flag          | Description                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--from=PATH` | Sync standards from another project. Analyzes differences, shows what's missing or changed, and lets you select which standards to import. |

---

## Quick Commands

Lightweight options for small tasks that don't need a full orchestrator workflow.

### `/dev-spec --quick ["task description"]`

The spec-only quick lane — a condensed subset of the development pipeline, run inside `/dev-spec`. Bootstraps a standard development task (`orchestrator-state.yml` with `orchestrator.entry_point: "dev-spec --quick"`), discovers and reads applicable standards, runs a brief codebase analysis, gathers condensed requirements, then writes the condensed specification directly on the fly — no `specification-creator` subagent (that delegation stays reserved for the full pipeline). Diagrams are optional and gated by a question; the specification audit is skipped (Exit Gate acceptance substitutes; `/reviews-spec-audit` stays available later). Bug-shaped work (proven defect) still requires the TDD red gate — it is never bypassed by `--quick`; use `/dev-bugfix` for the quick TDD lane.

**When to use**: You want a standards-aware, resumable spec before any plan — but the spec alone is enough for now.

**Task directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` (standard structure)
**Artifacts**: `analysis/requirements.md`, `analysis/quick-analysis.md`, `implementation/spec.md`

After the spec it stops at the dev-spec exit gate — continue the pipeline with `/dev-plan` (or `/development <task-path>`), or stop there if the spec is enough.

### `/dev-plan --quick ["task description"]`

The plan-only quick lane — a condensed subset of the development pipeline, run inside `/dev-plan`. Bootstraps a standard development task (`orchestrator-state.yml` with `orchestrator.entry_point: "dev-plan --quick"`), discovers and reads applicable standards, writes a brief analysis and a condensed spec, then writes the implementation plan directly on the fly — no `implementation-planner` subagent (that delegation stays reserved for the full pipeline). The on-the-fly plan stays lean and grounded: key discoveries with `file:line` references, an explicit out-of-scope list, intent + contract per step, automated vs manual acceptance criteria, and no open questions. Adding an execution diagram is optional and gated by a question.

**When to use**: You want a standards-aware, resumable plan before coding — but the plan alone is enough for now.

**Task directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` (standard structure)
**Artifacts**: `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`

After planning it stops at the dev-plan exit gate — continue the pipeline with `/dev-implement` (or `/development <task-path>`), or stop there if the plan is enough.

### `/dev-implement --quick ["task description"]`

The quick development lane — a condensed subset of the development pipeline, run inside `/dev-implement`. Bootstraps a standard development task (`orchestrator-state.yml` with `orchestrator.entry_point: "dev-implement --quick"`), discovers and reads applicable standards, writes a condensed spec + implementation plan, and asks for approval before implementing. Execution is delegated like any other development task.

**When to use**: Task is clear, no architectural decisions needed, you know what needs doing.

**Task directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` (standard structure)
**Artifacts**: `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`, `implementation/work-log.md`

After implementation it stops at the dev-implement exit gate — continue the pipeline with `/dev-verify` (or `/development <task-path>`), or stop there if the results are enough.

### `/dev-bugfix [bug description | task-path]`

Quick TDD-driven bug fix — an alternative entry point into the dev-* workflow with a standard `orchestrator-state.yml`. Analyzes the bug, presents a fix plan for approval, writes a failing test, implements the fix, and verifies the test passes.

**When to use**: Simple, isolated bugs where you can quickly identify the root cause. If the bug is too complex (multiple files, unclear root cause, architectural impact), the skill suggests escalating to `/development`.

**Task directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` (standard structure, `entry_point: "dev-bugfix"`)
**Artifacts**: `analysis/findings.md`, `implementation/fix-plan.md`, `implementation/tdd-red-gate.md`, `implementation/tdd-green-gate.md`, `implementation/work-log.md`, `summary.md`

**Two invocation modes**:

- **Standalone** — bug description (or nothing: reads the conversation or prompts) bootstraps a fresh standard development task. After the fix, continue with `/dev-verify <task-path>` or commit.
- **Consecutive run** — a task path/identifier under `.owflow/tasks/development/` fixes a newly emerging problem on an existing development task (after implementation or verification); the fix is appended to the task and downstream verification slugs are reset so the pipeline re-runs `/dev-verify`.
