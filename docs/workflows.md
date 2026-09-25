# Workflow Details

Owflow provides four workflow types, each with phases tailored to its needs. All workflows pause between phases for your review and input.

## Development Workflow

Development work runs through a pipeline of standalone **dev-\* subskills**, coordinated by a shared task state file (`orchestrator-state.yml`). Two top-level orchestrators start and route the pipeline:

- **Assisted mode** — `/owflow:development` initializes/resumes the task, derives the next step from state, prints the matching subskill command, and stops. Each subskill runs in a fresh context.
- **Autonomous mode** — `/owflow:goal-development` runs the same subskills back-to-back in one session, pausing at gates between them. Tasks can mix both modes freely.

Both modes share one state format. Progress is tracked as descriptive step slugs in `completed_phases`: `codebase-analysed`, `gap-analysed`, `tdd-red-proven`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `tdd-green-proven`, `options-chosen`, `verification-done`, `e2e-run`, `docs-generated`, `task-completed`.

### Pipeline Steps

| Step slug(s)             | Description                    | Subskill                | Produces                                              |
| ------------------------ | ------------------------------ | ----------------------- | ----------------------------------------------------- |
| `codebase-analysed`      | Codebase + gap analysis        | `/owflow:dev-analyze`   | `analysis/codebase-analysis.md`, `gap-analysis.md`    |
| `tdd-red-proven`         | TDD red gate (conditional — bugs) | `/owflow:dev-tdd-red`   | `implementation/tdd-red-gate.md` (failing test)       |
| `spec-written`, `spec-audited` | Requirements + specification + audit | `/owflow:dev-spec`      | `implementation/spec.md`, `verification/spec-audit.md`|
| `plan-created`           | Implementation planning        | `/owflow:dev-plan`      | `implementation/implementation-plan.md`               |
| `implementation-done`    | Implementation + TDD green gate | `/owflow:dev-implement` | implemented code, `work-log.md`; (full pipeline delegates to implementation-plan-executor) |
| `options-chosen`, `verification-done` | Verification + issue resolution | `/owflow:dev-verify`    | `verification/implementation-verification.md`         |
| `e2e-run`, `docs-generated`, `task-completed` | E2E + user docs + finalization | `/owflow:dev-finalize`  | `documentation/`, completed task                      |

The TDD red gate is skipped unless gap analysis detects a reproducible defect (`has_reproducible_defect: true`). The TDD green gate runs inside dev-implement only when a red gate was executed. Conditional options (`--e2e`, `--user-docs`, `--audit`) are stored in state and honored by the subskills.

### Entry Points

Every entry level below ends in the same pipeline and the same state file — you can enter fast and escalate to the full pipeline at any time.

#### 1. Full pipeline (features, enhancements, bugs)

```bash
/owflow:development "Add two-factor authentication"
/owflow:goal-development "Add two-factor authentication"     # autonomous mode
```

Auto-detects the task type. The dispatcher initializes the task, then hands off step-by-step.

```mermaid
flowchart TD
    Start["/owflow:development or /owflow:goal-development"] --> Init["Create task dir + orchestrator-state.yml"]
    Init --> A["dev-analyze<br/>codebase-analysed, gap-analysed"]
    A --> Red{"has_reproducible_defect?"}
    Red -- "yes" --> R["dev-tdd-red<br/>tdd-red-proven"]
    Red -- "no" --> S
    R --> S["dev-spec<br/>spec-written, spec-audited"]
    S --> P["dev-plan<br/>plan-created"]
    P --> I["dev-implement<br/>implementation-done, tdd-green-proven"]
    I --> V["dev-verify<br/>options-chosen, verification-done"]
    V --> F["dev-finalize<br/>e2e-run, docs-generated, task-completed"]
    F --> Done["Task completed<br/>commit / reviews-*"]
    Q["Quick dev lane: --quick flag converges analysis + spec + plan into one condensed pass"] -.-> P
    S -. quick-lane tasks skip straight to dev-implement .-> I
```

#### 2. Assisted vs Autonomous mode

```mermaid
flowchart TD
    Entry["Same task, same state file"] --> H["Assisted mode<br/>/owflow:development"]
    Entry --> L["Autonomous mode<br/>/owflow:goal-development"]
    H --> H1["dev-analyze"] --> H1Q{"Results accepted?"} --> H2["dev-spec"] --> H2Q{"Results accepted?"} --> H3["dev-plan"] --> H3Q{"Results accepted?"} --> H4["dev-implement"] --> H4Q{"Results accepted?"} --> H5["dev-verify"] --> H5Q{"Results accepted?"} --> H6["dev-finalize"]
    L --> L1["dev-analyze → dev-spec → dev-plan →<br/>dev-implement → dev-verify → dev-finalize<br/>(all in one session)"] --> LQ{"Final results accepted?"}
    H6 --> Done["Task completed"]
    LQ --> Done
```

#### 3. Quick bug lane (`/owflow:dev-bugfix`)

Lightweight TDD-driven bug fix: condensed analysis → approved fix plan → TDD red → fix → TDD green. Creates a **standard** development task (`entry_point: dev-bugfix`), so it is continuable by any dev-\* subskill afterwards. Also used as a consecutive run to fix a newly emerging problem on an existing task (resets downstream verification slugs).

```mermaid
flowchart TD
    B["/owflow:dev-bugfix<br/>bug description OR existing-task path"] --> Mode{"What argument was passed?"}
    Mode -- "bug description" --> Stand["Step 1: create a new standard task<br/>Step 2: condensed bug analysis<br/>Step 3: fix plan approval"]
    Mode -- "existing-task path" --> Cons["Step 1: reuse the existing task<br/>Step 2: reset downstream verification slugs"]
    Stand --> Esc{"Complexity escalation check"}
    Esc -- "simple bug" --> Red
    Esc -- "complex bug (2+ signals)" --> Escalate["task.status: escalated<br/>continue via /owflow:development <task-path><br/>fill in spec + plan"]
    Cons --> Red["Step: write a failing test (TDD red)"]
    Red --> Green["Step: fix + failing test passes (TDD green)"]
    Green --> Verify["Step: continue with /owflow:dev-verify <task-path>"]
```

The dispatcher routes bugfix tasks straight to `/owflow:dev-verify` when `implementation-done` is complete (spec/plan are not required for verification). Escalated tasks route through the full pipeline from the first missing slug.

#### 4. Quick dev lane (`--quick`)

Condensed entries that bootstrap a standard task inline, then continue with the lane's condensed work. Three lanes, one per phase cut-off: `/owflow:dev-spec --quick` (spec only), `/owflow:dev-plan --quick` (spec + plan), `/owflow:dev-implement --quick` (spec + plan + implementation). Use when analysis/spec phases can be done in one pass.

```mermaid
flowchart TD
    QS["/owflow:dev-spec --quick desc"] --> QB0["Step 1: bootstrap task + standards + quick analysis<br/>Step 2: condensed requirements<br/>Step 3: write condensed spec directly (no specification-creator subagent)<br/>spec-written, audit skipped (lane stops)"]
    QP["/owflow:dev-plan --quick desc"] --> QB1["Step 1: bootstrap task + condensed spec"]
    QI["/owflow:dev-implement --quick desc"] --> QB2["Step 1: bootstrap task + condensed spec<br/>Step 2: write plan directly (no planner subagent)"]
    QB0 --> Choice0{"Continue with"}
    Choice0 -- "/owflow:dev-plan" --> NPlan["Full delegated planning"]
    Choice0 -- "/owflow:dev-plan --quick" --> Plan
    QB1 --> Plan["implementation-plan.md saved<br/>plan-created (lane stops)"]
    QB2 --> Impl["Step 3: implement directly in main agent<br/>with discovered standards<br/>implementation-done"]
    Plan --> Choice{"Continue with"}
    Choice -- "/owflow:dev-implement" --> NImpl["Full delegated implementation"]
    Choice -- "/owflow:dev-implement --quick" --> Impl
    NPlan --> Choice
    NImpl --> Next
    Impl --> Next["Step: continue with /owflow:dev-verify <task-path><br/>or stop — task stays resumable"]
```

Quick lanes do not use the pipeline's subagents: `dev-spec --quick` writes the condensed spec directly (no `specification-creator`), `dev-plan --quick` writes the plan directly (no `implementation-planner`), and `dev-implement --quick` implements **directly in the main agent** (no `implementation-plan-executor`), applying the standards read during the condensed prelude (with continuous discovery for newly-surfaced areas). The same applies when `--quick` is passed to those subskills on an existing task (e.g., a quick spec or quick plan). Full-pipeline runs are unaffected: without `--quick`, specification, planning, and implementation always delegate. Anything bug-shaped (a proven reproducible defect) still routes through the TDD red gate — `--quick` never bypasses it; see the bugfix lane above.

#### 5. Research-based development

Start interactive development workflow informed by a completed research workflow:

```bash
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research
/owflow:development "Implement OAuth" --research=.owflow/tasks/research/2026-01-12-oauth-research
```

```mermaid
flowchart TD
    R["Research task<br/>outputs: research-report, solution-exploration,<br/>high-level-design, decision-log"] --> D["/owflow:development <research-path><br/>or --research=PATH"]
    D --> Copy["Artifacts copied to analysis/research-context/<br/>research_reference set in state"]
    Copy --> A["dev-analyze — research guides codebase/gap analysis"]
    A --> S["dev-spec — design + decisions as spec INPUT"]
    S --> P["dev-plan<br/>plan-created"]
    P --> I["dev-implement<br/>implementation-done, tdd-green-proven"]
    I --> V["dev-verify<br/>options-chosen, verification-done"]
    V --> F["dev-finalize<br/>e2e-run, docs-generated, task-completed"]
```

#### 6. Standalone subskills

Each dev-\* subskill is standalone and can be invoked directly with a task path or identifier; it validates prerequisites from state and prints the ordered prerequisite steps with exact commands if something is missing. Never auto-picks a task. The usual reason to enter mid-pipeline is resuming: `/owflow:dev-verify`, `/owflow:dev-finalize`, or continuing an escalated/bugfix task with `/owflow:dev-spec`.

### Flags

`--from=<step-slug>`, `--research=PATH`, `--audit`/`--no-audit`, `--e2e`/`--no-e2e`, `--user-docs`/`--no-user-docs`

### Resume

```bash
/owflow:development [task-path] [--from=<step-slug>] [--reset-attempts]
```

Resume derives from state: the first step slug not in `completed_phases` determines the next subskill; `--from` overrides (prerequisites are validated). Works across assisted and autonomous modes, including tasks started by `/owflow:dev-bugfix` or a `--quick` lane.

### Auto-Recovery

Retries are owned by each subskill (max attempts per phase):

| Subskill       | Max Attempts | Strategy                            |
| -------------- | ------------ | ----------------------------------- |
| dev-analyze    | 2            | Expand search, re-analyze, ask user |
| dev-tdd-red    | 2            | Rewrite test, skip TDD with doc     |
| dev-spec       | 2            | Regenerate spec                     |
| dev-plan       | 2            | Regenerate plan                     |
| dev-implement  | 5 (green)    | Fix syntax, imports, tests          |
| dev-verify     | 3 (loop)     | Fix issues, re-run verification     |
| dev-finalize   | 3            | Fix tests, re-run                   |

---

## Performance Optimization

Static code analysis to detect bottlenecks, followed by standard spec/plan/implement/verify pipeline.

```
/owflow:performance
/owflow:performance "Optimize dashboard loading time"
```

### Phases

| #   | Phase                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------- |
| 1   | Codebase analysis + clarifications                                                                        |
| 2   | Static performance analysis (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks) |
| 3   | Requirements + specification                                                                              |
| 4   | Specification audit (conditional)                                                                         |
| 5   | Implementation planning                                                                                   |
| 6   | Implementation execution                                                                                  |
| 7   | Verification options                                                                                      |
| 8   | Verification + issue resolution                                                                           |
| 9   | Finalization                                                                                              |

**Optional profiling data**: You can provide runtime profiling data, flame graphs, or APM screenshots. The workflow creates `analysis/user-profiling-data/` for these files.

### Resume

```
/owflow:performance [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

Technology, data, and architecture migrations with rollback planning and risk assessment.

```
/owflow:migration
/owflow:migration "Migrate from REST to GraphQL" --type=code
```

**Migration types**: `code`, `data`, `architecture`, `general`

### Phases

| #   | Phase                                                                    |
| --- | ------------------------------------------------------------------------ |
| 1   | Current state analysis                                                   |
| 2   | Target state planning + gap identification                               |
| 3   | Migration requirements + strategy specification (includes rollback plan) |
| 4   | Implementation planning                                                  |
| 5   | Migration execution                                                      |
| 6   | Verification + compatibility testing                                     |
| 7   | Issue resolution (conditional, halts on data integrity issues)           |
| 8   | Documentation (optional)                                                 |

**Key behaviors**:

- Rollback planning is mandatory
- Dual-run support for zero-downtime migrations
- Halts on data integrity issues (no automatic recovery)
- External research for version upgrades via web search

### Resume

```
/owflow:migration [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

Multi-source research with synthesis, optional solution brainstorming, and high-level design.

```
/owflow:research
/owflow:research "What authentication approach fits our architecture?" --type=technical
```

**Research types**: `technical`, `requirements`, `literature`, `mixed`

**Flags**: `--brainstorm` (force brainstorming phases), `--no-brainstorm` (skip them)

### Phases

| #   | Phase                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------- |
| 1   | Research foundation: initialize → plan methodology → gather information (parallel) → synthesize findings |
| 2   | Brainstorming decision (evaluate value)                                                                  |
| 3   | Solution brainstorming (HMW questions + user preferences)                                                |
| 4   | High-level design (C4 diagrams + ADR documentation)                                                      |
| 5   | Review outputs                                                                                           |
| 6   | Verification (optional)                                                                                  |
| 7   | Integration (optional)                                                                                   |
| 8   | Spawn development workflow (optional)                                                                    |

Information gathering runs parallel subagents across multiple source categories (codebase, docs, config, external).

### Resume

```
/owflow:research [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `foundation`, `brainstorming-decision`, `brainstorming`, `design`, `outputs`, `verification`, `integration`

---

## Task Directory Structure

All workflows create structured directories in `.owflow/tasks/`:

```
.owflow/tasks/
├── development/           # All development tasks (features, bugs, enhancements)
├── performance/           # Performance optimization
├── migrations/            # Migrations
├── research/              # Research
```

Each task folder follows the pattern `YYYY-MM-DD-task-name/`. Development tasks (shown below) carry the full pipeline artifacts — every entry point (dispatcher, autonomous mode, bugfix lane, quick lanes) writes into this same structure:

```
2026-02-17-user-auth/
├── orchestrator-state.yml          # Canonical state — step slugs, options, summaries
├── summary.md                      # dev-bugfix fix-run summary (if used)
├── analysis/
│   ├── codebase-analysis.md        # dev-analyze
│   ├── clarifications.md           # dev-analyze
│   ├── gap-analysis.md             # dev-analyze
│   ├── findings.md                 # dev-bugfix (condensed bug analysis)
│   ├── quick-analysis.md           # quick lanes (condensed prelude analysis)
│   ├── requirements.md             # dev-spec / dev-spec --quick
│   ├── research-context/           # Research artifacts (if --research used)
│   └── visuals/                    # user-provided mockups
├── implementation/
│   ├── spec.md                     # Specification (WHAT to build) — dev-spec / quick lanes
│   ├── implementation-plan.md      # Step breakdown (HOW) — dev-plan
│   ├── fix-plan.md                 # dev-bugfix (condensed, approval-gated)
│   ├── tdd-red-gate.md             # dev-tdd-red / dev-bugfix (conditional)
│   ├── tdd-green-gate.md           # dev-implement / dev-bugfix (conditional)
│   └── work-log.md                 # Chronological activity log
├── verification/
│   ├── spec-audit.md               # dev-spec (recommended)
│   ├── implementation-verification.md  # dev-verify
│   └── e2e-verification-report.md  # dev-finalize (optional)
└── documentation/                  # User-facing docs (optional)
```

## Internal Skills

These skills are invoked automatically by the orchestrators and dev-\* subskills — you don't call them directly:

| Skill                            | What It Does                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **codebase-analyzer**            | Launches parallel Explore subagents to analyze your codebase, synthesizes findings into a report                                                |
| **implementer**                  | Executes implementation plans with mandatory standards reading and test-driven enforcement                                                      |
| **implementation-plan-executor** | Delegates every task group to the task-group-implementer subagent with continuous standards discovery (full-pipeline runs only — `--quick` tasks implement directly in dev-implement)                 |
| **implementation-verifier**      | Delegates verification to specialized subagents: test runner, code reviewer, pragmatic reviewer, reality assessor, production readiness checker |
| **task-classifier**              | Classifies task descriptions into types (bug, feature, enhancement, performance, migration, research) with confidence scoring                   |
| **docs-manager**                 | Internal engine for managing `.owflow/docs/` structure, INDEX.md, and standards files                                                           |
