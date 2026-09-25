---
name: owflow:development
description: Development workflow dispatcher. Initializes/resumes development tasks, derives the next phase from state, and hands off to the matching /owflow:dev-* subskill. Use /owflow:goal-development to run all phases in one loop.
argument-hint: "[task description | task-path] [--from=<step-slug>] [--research=PATH] [--e2e] [--user-docs]"
user-invocable: true
---

# Development Dispatcher

Entry point for development tasks in **assisted mode**: initialize (or resume) the task, derive the next pending step from `orchestrator-state.yml`, print the matching subskill command, and STOP. Each `/owflow:dev-*` subskill runs its steps with fresh context — the explicit invocation IS the step gate.

Development state uses descriptive step slugs in `completed_phases` / `failed_phases` / `auto_fix_attempts` (NOT phase numbers): `codebase-analysed`, `gap-analysed`, `tdd-red-proven`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `tdd-green-proven`, `options-chosen`, `verification-done`, `e2e-run`, `docs-generated`, `task-completed`. The routing table below maps slugs to subskills.

For the all-in-one loop with in-session `question` gates, use `/owflow:goal-development`.

Gates follow the shared contract in the [Gate Contract](../orchestrator-framework/references/gate-contract.md), with the [dispatcher exception](../orchestrator-framework/references/gate-contract.md).

## Entry Gate

**BEFORE deriving the handoff, complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. The [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) and [Command Namespacing](../orchestrator-framework/references/command-namespacing.md) govern this skill.

### Step 2: Detect Prior Work Context

**If argument is a research folder path** (matches `.owflow/tasks/research/*`):

- Auto-detect research folder, extract task description from `research_context.research_question`
- Read research artifacts (see Research-Based Development below)
- Set `research_reference` in state automatically

**If `--research=<path>` flag provided**:

- Read research artifacts from specified path, copy to `analysis/research-context/`
- Set `research_reference` in state

**If the task's state shows `orchestrator.entry_point: "dev-bugfix"`** (task created or last run by the quick bug fix skill):

1. No special intake needed — it is a standard development task using the standard state file and artifacts. Its dev-bugfix run already recorded condensed analysis and TDD slugs in `completed_phases`.
2. Route by the FIRST step slug NOT in `completed_phases`, per the Routing Table — with one exception: if `implementation-done` is already complete (typical for a completed dev-bugfix run), route to `/owflow:dev-verify <task-path>`; verification does NOT require spec/plan. If the task's status is `escalated`, route normally from the first missing slug (usually `spec-written`).

The dispatcher hands off to subskills from analysis onward — spec, plan, verify, finalize steps are unchanged; research context flows through all of them.

**How dev-bugfix context informs subskills**: dev-spec receives `phase_summaries.quick_analysis` (root cause, affected files, test strategy) as condensed analysis input; dev-verify receives the fix summary.

### Step 3: Initialize or Resume

**New task** (description argument):

1. **Create Task Directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/`
2. **Initialize State**: create `orchestrator-state.yml` with task info, research/quick reference, flags
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-development.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section; store as `project_context.project_doc_paths` in state.
4. **Command flags** (`--e2e`, `--no-e2e`, `--user-docs`, `--no-user-docs`, `--audit`, `--no-audit`) → write to `options.*` in state. Subskills read them from there.

**Resume** (task-path argument):

1. Read `orchestrator-state.yml`; validate expected artifacts for `completed_phases` (remove entries with missing artifacts)
2. Find resume point: first step slug NOT in `completed_phases`; `--from=<step-slug>` overrides (validate prerequisites exist, else use `question`)

**Output**:

```
🚀 Development Dispatcher

Task: [description]
Directory: [task-path]
Next step: [step name]
```

---

## When to Use

Use for **all development tasks**: bug fixes, enhancements, new features, and any work that modifies code. Bug-shaped work has a lighter entry point: `/owflow:dev-bugfix "<description>"` (or with a task path, to fix a bug that emerged on an existing task) — it produces the same standard state and is resumable by this dispatcher. Condensed quick lanes also exist per phase — `/owflow:dev-spec --quick "<description>"`, `/owflow:dev-plan --quick "<description>"`, `/owflow:dev-implement --quick "<description>"` — each bootstraps the same standard state and stops after its phase.

**DO NOT use for**: Performance optimization, security remediation, migrations, documentation-only, pure refactoring (use the specialized orchestrators).

---

## Routing Table (completed_phases → next subskill)

Derive the FIRST step slug not in `completed_phases`, then print the matching command:

| Next step (slug)                                              | Condition (from state)                                     | Handoff command                       | Produces                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| Analysis (`codebase-analysed`, `gap-analysed`)                | Always (new task or partial analysis)                      | `/owflow:dev-analyze <task-path>`     | `analysis/codebase-analysis.md`, `gap-analysis.md` |
| TDD red gate (`tdd-red-proven`)                               | `task_characteristics.has_reproducible_defect: true`       | `/owflow:dev-tdd-red <task-path>`     | `implementation/tdd-red-gate.md`                   |
| Specification (`spec-written`, `spec-audited`)                | `gap-analysed` completed (and `tdd-red-proven` if required)| `/owflow:dev-spec <task-path>`        | `implementation/spec.md`, `verification/spec-audit.md` |
| Planning (`plan-created`)                                     | `implementation/spec.md` exists                            | `/owflow:dev-plan <task-path>`        | `implementation/implementation-plan.md`            |
| Implementation (`implementation-done`, `tdd-green-proven`)    | Spec + plan exist                                          | `/owflow:dev-implement <task-path>`   | implemented code, `work-log.md`                    |
| Verification (`options-chosen`, `verification-done`)          | `implementation-done` completed (also dev-bugfix tasks — see entry gate note; spec/plan NOT required)                                                                 | `/owflow:dev-verify <task-path>`      | `verification/implementation-verification.md`      |
| Finalization (`e2e-run`, `docs-generated`, `task-completed`)  | `verification-done` completed                              | `/owflow:dev-finalize <task-path>`    | `documentation/`, completed task                   |

The TDD red gate is SKIPPED when `has_reproducible_defect` is false — route to dev-spec. All conditional flags (`e2e_enabled`, `user_docs_enabled`) live in state and are honored by the subskills.

**Dev-bugfix tasks**: tasks whose `completed_phases` holds the quick slice (`codebase-analysed`, `gap-analysed`, `tdd-red-proven`, `implementation-done`, `tdd-green-proven` — no `spec-written`/`plan-created`) are valid dev tasks. The FIRST-missing-slug rule would route them to `dev-spec`; instead, when `implementation-done` is complete, prefer `/owflow:dev-verify`. Escalated (`task.status: escalated`) dev-bugfix tasks route normally from the first missing slug — the full pipeline fills in specification and planning.

**Alternative entry points for bugs**: `/owflow:dev-bugfix "<description>"` — standalone bug fix creating the same state from scratch; `/owflow:dev-bugfix <task-path>` — fix a newly emerging problem on an existing dev task (resets downstream verification slugs after the fix, so this router re-routes to dev-verify).

### Exit Gate (adapted for dispatch mode)

After deriving the handoff, present the results box, ask how to proceed, then hand off accordingly (see the [dispatcher exception](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the subskill.

#### Results box

```markdown
## ✅ DEVELOPMENT TASK READY — <task name>

**Task** — [description]
**Directory** — `<task-path>`
**Next step** — [step name]
[Resume note: completed steps / fresh task]

**Next ▸** `/owflow:<subskill> <task-path>`
```

#### Acceptance question

Use `question` — "Task ready. How would you like to proceed?" with options:

- **Hand off to /owflow:<subskill>** — the user invokes the suggested command (dispatcher copies it to chat for convenience). Execution starts in a fresh context.
- **Switch to autonomous mode** — illustrate with `/owflow:goal-development <task-path>` to run remaining phases in one session with gates.
- **Adjust** — task set-up is wrong (wrong flags, wrong research reference, wrong task); re-run the affected initialization step, re-present the results box.
- **Stop here** — print the resume command (`/owflow:development <task-path>`) and end.

#### Handoff message

On Accept (hand off choice), print, then STOP:

```
✓ Task ready at <task-path>

Next step:
  → /owflow:<subskill> <task-path>

Other options:
  /owflow:goal-development <task-path>   — run remaining phases in one loop
  /owflow:development --from=<step-slug> <task-path>   — jump to a specific step
```

---

## Task Structure

```
.owflow/tasks/development/YYYY-MM-DD-task-name/
├── orchestrator-state.yml          # Canonical state — all modes share it
├── analysis/
│   ├── research-context/           # If --research provided
│   ├── codebase-analysis.md        # dev-analyze
│   ├── clarifications.md           # dev-analyze
│   ├── gap-analysis.md             # dev-analyze
│   ├── scope-clarifications.md     # dev-analyze (conditional)
│   ├── technical-clarifications.md # dev-spec (conditional)
│   ├── requirements.md             # dev-spec
│   └── visuals/                    # user-provided mockups
├── implementation/
│   ├── spec.md                     # dev-spec
│   ├── implementation-plan.md      # dev-plan
│   ├── fix-plan.md                 # dev-bugfix (condensed approval-gated fix plan)
│   ├── work-log.md                 # dev-implement / dev-bugfix
│   ├── tdd-red-gate.md             # dev-tdd-red / dev-bugfix (conditional)
│   └── tdd-green-gate.md           # dev-implement / dev-bugfix (conditional)
├── summary.md                      # dev-bugfix (per fix run)
├── verification/
│   ├── spec-audit.md               # dev-spec (recommended)
│   ├── implementation-verification.md  # dev-verify
│   └── e2e-verification-report.md  # dev-finalize (optional)
└── documentation/
    └── user-guide.md               # dev-finalize (optional)
```

---

## Auto-Recovery

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

## Command Flags

| Flag                             | Effect                          |
| -------------------------------- | ------------------------------- |
| `--from=<step-slug>`             | Hand off from a specific step   |
| `--research=PATH`                | Link to completed research task |
| `--audit` / `--no-audit`         | Force/skip specification audit  |
| `--e2e` / `--no-e2e`             | Force/skip E2E testing          |
| `--user-docs` / `--no-user-docs` | Force/skip user documentation   |

---

## Research-Based Development

When starting from a completed research task, the dispatcher loads research context to **INFORM** all subskills — research never SKIPS phases. Artifacts pass via `task_context.phase_summaries.research` in state and `analysis/research-context/`.

### Invocation Methods

**Method 1: Research folder as sole argument** (recommended)

```
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research
```

**Method 2: Explicit --research flag**

```
/owflow:development "Implement OAuth" --research=.owflow/tasks/research/2026-01-12-oauth-research
```

### Research Artifacts (Standard List)

| Artifact             | Path                              | Purpose                                        |
| -------------------- | --------------------------------- | ---------------------------------------------- |
| State                | `orchestrator-state.yml`          | research_type, confidence_level                |
| Report               | `outputs/research-report.md`      | Main findings and conclusions                  |
| Solution Exploration | `outputs/solution-exploration.md` | Alternatives and trade-offs (input to dev-spec) |
| High-Level Design    | `outputs/high-level-design.md`    | C4 architecture (input to dev-spec)            |
| Decision Log         | `outputs/decision-log.md`         | ADR decisions (input to dev-spec)              |

### How Research Informs Subskills

| Subskill      | How Research Context is Used                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev-analyze   | Codebase analyzer and gap analyzer receive research findings as search/comparison guidance                                                                 |
| dev-spec      | specification-creator uses high-level-design.md as INPUT (still creates full spec); architecture decisions use research report AND decision-log.md        |
| dev-plan      | implementation-planner references research approach for task grouping                                                                                     |

---

## Command Integration

Invoked via:

- `/owflow:development [description] [--e2e] [--user-docs] [--research=PATH]` (new)
- `/owflow:development [task-path] [--from=<step-slug>] [--reset-attempts]` (resume)

Alternative: `/owflow:goal-development` — same task lifecycle, all subskills invoked in one session with `question` gates.

---

## TDD Gate Rules

**Red Gate** (`/owflow:dev-tdd-red`): test MUST FAIL before implementation — activated when gap analysis detects a reproducible defect.
**Green Gate** (inside `/owflow:dev-implement`): the same test MUST PASS after implementation — activated when the red gate was executed.
