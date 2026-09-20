---
name: owflow:development
description: Development workflow dispatcher. Initializes/resumes development tasks, derives the next phase from state, and hands off to the matching /owflow:dev-* subskill. Use /owflow:goal-development to run all phases in one loop.
argument-hint: "[task description | task-path] [--from=PHASE] [--research=PATH] [--e2e] [--user-docs]"
user-invocable: true
---

# Development Dispatcher

Entry point for development tasks in **handoff mode**: initialize (or resume) the task, derive the next pending phase from `orchestrator-state.yml`, print the matching subskill command, and STOP. Each `/owflow:dev-*` subskill runs its phases with fresh context — the explicit invocation IS the phase gate.

For the all-in-one loop with in-session `question` gates, use `/owflow:goal-development`.

Gates follow the shared contract in `../orchestrator-framework/references/orchestrator-patterns.md` Section 9 (adapted for dispatch mode — see its Exceptions).

## Entry Gate

**BEFORE deriving the handoff, complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` — Section 7 (Dispatcher & Handoff Pattern) and Section 8 (Command Namespacing) govern this skill.

### Step 2: Detect Prior Work Context

**If argument is a research folder path** (matches `.owflow/tasks/research/*`):

- Auto-detect research folder, extract task description from `research_context.research_question`
- Read research artifacts (see Research-Based Development below)
- Set `research_reference` in state automatically

**If `--research=<path>` flag provided**:

- Read research artifacts from specified path, copy to `analysis/research-context/`
- Set `research_reference` in state

**If argument is a quick-\* task folder path** (matches `.owflow/tasks/quick-*/`):

1. Read `task.yml` — extract `command`, `description`, `standards_applied`, `escalation_reason`
2. Read `analysis/findings.md` — root cause, affected files, complexity assessment, test strategy
3. Use `description` as the task description; set `quick_reference` in orchestrator state (see template)
4. Update the quick-\* `task.yml`: set `escalated_to` to the new development task path

**How quick-\* context informs subskills**: dev-analyze receives affected files/root cause as search guidance; dev-spec receives complexity assessment and test strategy; gap analysis uses the complexity assessment for risk level.

### Step 3: Initialize or Resume

**New task** (description argument):

1. **Create Task Directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/`
2. **Initialize State**: create `orchestrator-state.yml` with task info, research/quick reference, flags
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-development.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section; store as `project_context.project_doc_paths` in state.
4. **Command flags** (`--e2e`, `--no-e2e`, `--user-docs`, `--no-user-docs`, `--audit`, `--no-audit`) → write to `options.*` in state. Subskills read them from there.

**Resume** (task-path argument):

1. Read `orchestrator-state.yml`; validate expected artifacts for `completed_phases` (remove entries with missing artifacts)
2. Find resume point: first phase NOT in `completed_phases`; `--from=PHASE` overrides (validate prerequisites exist, else use `question`)

**Output**:

```
🚀 Development Dispatcher

Task: [description]
Directory: [task-path]
Next phase: [N — phase name]
```

---

## When to Use

Use for **all development tasks**: bug fixes, enhancements, new features, and any work that modifies code.

**DO NOT use for**: Performance optimization, security remediation, migrations, documentation-only, pure refactoring (use the specialized orchestrators).

---

## Routing Table (completed_phases → next subskill)

Derive the FIRST phase not in `completed_phases`, then print the matching command:

| Next phase    | Condition (from state)                                     | Handoff command                       | Produces                                          |
| ------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| 1–2           | Always (new task or partial analysis)                      | `/owflow:dev-analyze <task-path>`     | `analysis/codebase-analysis.md`, `gap-analysis.md` |
| 3             | `task_characteristics.has_reproducible_defect: true`       | `/owflow:dev-tdd-red <task-path>`     | `implementation/tdd-red-gate.md`                   |
| 4–5           | Analysis complete (and red gate done if required)          | `/owflow:dev-spec <task-path>`        | `implementation/spec.md`, `verification/spec-audit.md` |
| 6             | `implementation/spec.md` exists                            | `/owflow:dev-plan <task-path>`        | `implementation/implementation-plan.md`            |
| 7–8           | Spec + plan exist                                          | `/owflow:dev-implement <task-path>`   | implemented code, `work-log.md`                    |
| 9–10          | `phase-7` completed                                        | `/owflow:dev-verify <task-path>`      | `verification/implementation-verification.md`      |
| 11–13         | `phase-10` completed                                       | `/owflow:dev-finalize <task-path>`    | `documentation/`, completed task                   |

Phase 3 is SKIPPED when `has_reproducible_defect` is false — route to dev-spec. All conditional flags (`e2e_enabled`, `user_docs_enabled`) live in state and are honored by the subskills.

### Exit Gate (adapted for dispatch mode)

After deriving the handoff, present the results box, ask how to proceed, then hand off accordingly (see `orchestrator-patterns.md` Section 9 — dispatcher exception). Never auto-invoke the subskill.

#### Results box

```
═══════════════════════════════════════════════════════
  DEVELOPMENT TASK READY: <task name>
═══════════════════════════════════════════════════════
  Task:           [description]
  Directory:      <task-path>
  Next phase:     [N — phase name]
  [Resume note: completed phases / fresh task]

  → /owflow:<subskill> <task-path>
═══════════════════════════════════════════════════════
```

#### Acceptance question

Use `question` — "Task ready. How would you like to proceed?" with options:

- **Hand off to /owflow:<subskill>** — the user invokes the suggested command (dispatcher copies it to chat for convenience). Execution starts in a fresh context.
- **Switch to loop mode** — illustrate with `/owflow:goal-development <task-path>` to run remaining phases in one session with gates.
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
  /owflow:development --from=PHASE <task-path>   — jump to a specific phase
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
│   ├── work-log.md                 # dev-implement
│   ├── tdd-red-gate.md             # dev-tdd-red (conditional)
│   └── tdd-green-gate.md           # dev-implement (conditional)
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
| `--from=PHASE`                   | Hand off from specific phase    |
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
- `/owflow:development [task-path] [--from=PHASE] [--reset-attempts]` (resume)

Alternative: `/owflow:goal-development` — same task lifecycle, all subskills invoked in one session with `question` gates.

---

## TDD Gate Rules

**Red Gate** (`/owflow:dev-tdd-red`): test MUST FAIL before implementation — activated when gap analysis detects a reproducible defect.
**Green Gate** (inside `/owflow:dev-implement`): the same test MUST PASS after implementation — activated when the red gate was executed.
