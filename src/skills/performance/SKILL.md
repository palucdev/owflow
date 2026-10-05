---
name: owflow:performance
description: Performance workflow dispatcher. Initializes/resumes performance tasks, derives the next step from state, and hands off to the matching /owflow:performance-* subskill. Static-analysis-first bottleneck identification (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks) with optional user-provided profiling data. Use /owflow:goal-performance to run all steps in one session.
argument-hint: "[task description | task-path] [--from=<step-slug>]"
user-invocable: true
---

# Performance Dispatcher

Entry point for performance tasks in **assisted mode**: initialize (or resume) the task, derive the next pending step from `orchestrator-state.yml`, print the matching subskill command, and STOP. Each `/owflow:performance-*` subskill runs its steps with fresh context — the explicit invocation IS the step gate. The dispatcher owns only initialization (task directory, state, six task items) and the drop-only resume trim; every task artifact is produced by the subskills (see [Task Structure](#task-structure)).

Performance state uses descriptive step slugs in `completed_phases` / `failed_phases` / `auto_fix_attempts` (NOT phase numbers): `codebase-analysed`, `bottlenecks-identified`, `spec-written`, `spec-audited` (conditional), `plan-created`, `implementation-done`, `options-chosen`, `verification-done`, `task-completed`. The routing table below maps slugs to subskills.

For the all-in-one loop with in-session `question` gates, use `/owflow:goal-performance`.

Gates follow the shared contract in the [Gate Contract](../orchestrator-framework/references/gate-contract.md), with the [dispatcher exception](../orchestrator-framework/references/gate-contract.md#exceptions).

## Entry Gate

**BEFORE deriving the handoff, complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference files NOW using the Read tool:**

1. The [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) governs this skill.
2. The [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) bound what subskills delegate.
3. The [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md) define state schema, initialization, and context passing.

### Step 2: Resolve the Argument

**If the argument is a task path or identifier** (a directory, or a directory name under `.owflow/tasks/performance/`) → **resume mode**:

1. Read `orchestrator-state.yml`.
2. **Resume validation (drop-only)** — before `completed_phases` is trusted, validate every entry against the two-kind resume table below; an entry whose marker is missing is DROPPED. The path never repairs or re-keys state.
3. Derive the next handoff with the Routing Table below.
4. `--from=<step-slug>` overrides the derived step — validate the target's upstream conditions exist (per the routing table and the target subskill's Entry Gate), else use `question` to confirm or cancel. An unknown slug → print the 9 accepted slugs and STOP.
5. Missing state file → print: `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.

**If the argument is a performance issue description** (any other free text) → new task.

**If nothing is provided** → ask via `question`: "What is slow or performance-constrained? Describe the symptom (endpoint, page, job), expected vs actual behavior, and any profiling data you have." — collect the description, plus optional profiling data paths, then WAIT. Never guess or auto-pick a task.

### Step 3: Initialize (new task)

1. **Create Task Directory**: `.owflow/tasks/performance/YYYY-MM-DD-task-name/` (3-5 kebab-case words from the description)
2. **Create Subdirectories**: `analysis/`, `analysis/user-profiling-data/`, `implementation/`, `verification/`
3. **Initialize State**: create `orchestrator-state.yml` from the performance template — `task.title` / `task.description` from the description, `task.status: in_progress`, `orchestrator.task_path`, `orchestrator.entry_point: "performance"` (template/bootstrap mechanic). Discover project documentation: read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section, and store them as `performance_context.project_doc_paths` in state.
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-performance.yml`.
4. **Create Task Items**: use `TaskCreate` for the six subskill handoffs (one item each, per the Task Configuration table), then set the execution order with `TaskUpdate addBlockedBy` (analyze → spec → plan → implement → verify → finalize). Record every created item's id in `orchestrator.task_ids` — the `goal-performance` wrapper updates these same ids at each hop instead of creating its own. On resume, refresh the already-evidenced items instead of re-creating them.

**Output**:

```
🚀 Performance Dispatcher

Task: [performance issue description]
Directory: [task-path]
Next step: [step name]
```

---

## When to Use

Use for:

- Application slow (response time issues, high latency)
- Need systematic bottleneck identification and resolution
- Want static code analysis for performance anti-patterns
- Have user-provided profiling data to act on
- Database query optimization needed
- Algorithm or I/O inefficiencies suspected

**DO NOT use for**: New features, bug fixes, refactoring without performance goals.

---

## Core Principles

1. **Static Analysis First**: Read code to detect patterns. Don't try to run profiling tools.
2. **User Data Welcome**: Incorporate user-provided profiling data when available
3. **Subskill Pipeline**: The optimization pipeline is the six `/owflow:performance-*` subskills — analyze → spec → plan → implement → verify → finalize — not inline phases; this dispatcher only routes.
4. **Conservative Estimates**: Provide improvement ranges, not false precision
5. **Practical Optimizations**: Focus on patterns the agent CAN detect and fix

---

## Task Configuration

One task item per subskill handoff (`TaskCreate` at init; ordered with `addBlockedBy`):

| Subskill | Slugs owned (frozen) | Task item content | Engine(s) |
| --- | --- | --- | --- |
| `performance-analyze` | `codebase-analysed`, `bottlenecks-identified` | "Analyze codebase & bottlenecks" | Skill `codebase-analyzer`; Task `bottleneck-analyzer` |
| `performance-spec` | `spec-written`, `spec-audited` (conditional) | "Gather requirements & create specification" | Task `specification-creator`; Task `spec-auditor`; Skill `diagrams-mermaid` |
| `performance-plan` | `plan-created` | "Plan implementation" | Task `implementation-planner`; Skill `diagrams-mermaid` |
| `performance-implement` | `implementation-done` | "Execute implementation" | Skill `implementation-plan-executor` |
| `performance-verify` | `options-chosen`, `verification-done` | "Verify implementation & resolve issues" | Skill `implementation-verifier` |
| `performance-finalize` | `task-completed` | "Finalize workflow" | Direct (inline-legal) |

---

## Routing Table (completed_phases → next subskill)

Every row is evaluated in order; the first matching row wins. **Every condition includes the absence of its own slug(s)** (the absence clause), the evaluation order is **total** (a fallback row closes it), and **the first-missing-slug heuristic is retired** for this table — see the routing rules below.

| # | Subskill (slugs owned) | Routes here when | Handoff command |
| --- | --- | --- | --- |
| 1 | `performance-analyze` (`codebase-analysed`, `bottlenecks-identified`) | new task, OR `codebase-analysed` absent, OR (`codebase-analysed` present AND `bottlenecks-identified` absent) | `/owflow:performance-analyze <task-path>` |
| 2 | `performance-spec` (`spec-written`, `spec-audited`) | `bottlenecks-identified` complete AND [ (`spec-written` absent) OR (`spec-audited` absent AND (`options.spec_audit_enabled` is **null OR `true`**)) ] | `/owflow:performance-spec <task-path>` |
| 3 | **`performance-plan`** (`plan-created`) | **`spec-written` complete AND `options.spec_audit_enabled` is non-null — the audit decision is settled — AND `plan-created` absent.** Never `spec-audited`. | `/owflow:performance-plan <task-path>` |
| 4 | `performance-implement` (`implementation-done`) | `plan-created` complete AND `implementation-done` absent | `/owflow:performance-implement <task-path>` |
| 5 | `performance-verify` (`options-chosen`, `verification-done`) | `implementation-done` complete AND [ `options-chosen` absent OR `verification-done` absent ] | `/owflow:performance-verify <task-path>` |
| 6 | `performance-finalize` (`task-completed`) | `verification-done` complete AND `task-completed` absent | `/owflow:performance-finalize <task-path>` |
| T | terminal | `task-completed` complete (validated by `task.status: completed`) → **no handoff**; report the task as done | — |
| F | **fallback** | **no row above matched** (anomalous state — e.g. `SW ∧ SA ∧ spec_audit_enabled: null`, or slugs present out of order after a hand-edited state). Report the state that failed to route, then route to `/owflow:performance-analyze <task-path>` | `/owflow:performance-analyze <task-path>` |

**Routing rules, normative.** These four sentences ship verbatim in the dispatcher; they are the guard's defense against its own simplification:

1. **Absence clause** — each row that *advances* the pipeline requires its own slugs to be absent from `completed_phases` (rows 1, 2, 3, 4, 6; row 5 is a re-entry row and requires only the sub-step it owns to be outstanding). No row ever fires on the strength of its own slug already being present.
2. **Row 2 re-enters `performance-spec` while the audit decision is undecided** (`spec_audit_enabled` null) *and* when it is decided-yes with no `spec-audited` slug; `performance-spec`'s own skip/resume rule settles it — re-ask only while the decision is `null`, never once it is non-null.
3. **Row 3 requires a settled decision** (`spec_audit_enabled` non-null), never the `spec-audited` slug. Audit-skipped therefore falls through to row 3 instead of looping.
4. **The first-missing-slug heuristic used by both shipped dispatchers is retired for this table** (`development/SKILL.md:87`, `research/SKILL.md:100`) and must not be reintroduced — the conditional audit makes row 2 a three-way disjunction. Any edit that collapses rows 2–3 back to a single "first missing slug" rule reintroduces the audit-skip resume loop.

**Why the fallback exists, stated honestly.** Its purpose is **totality**: a total routing function never leaves the user without a command. Its destination is row 1's destination, and that destination is **not** guaranteed to block — row 1 can only fail when `codebase-analysed` ∧ `bottlenecks-identified` are both recorded, which means both analyze marker artifacts exist, so `performance-analyze`'s Entry Gate would *pass*. F therefore guarantees a defined, reported destination; it does not itself guarantee that a prerequisite check will stop the flow. The states F actually catches are the unreachable-by-design ones (`spec-written` ∧ `spec-audited` with the decision `null`) and hand-edited states — in both cases re-running analyze is the safe, reversible move.

Every reachable state routes to exactly one handoff:

| Reachable state | Matching row | Handoff |
| --- | --- | --- |
| new task, or analyze step 1 done (`codebase-analysed` absent) | 1 | `performance-analyze` |
| analyze done, `bottlenecks-identified` absent | 1 | `performance-analyze` |
| **spec step 1 done, audit decision still `null`** | **2** | **`performance-spec` (asks the audit decision)** |
| audit decided `true`, `spec-audited` absent | 2 | `performance-spec` (audit sub-step) |
| audit ran (`spec-audited` present, decision `true`) | 3 | `performance-plan` |
| audit skipped (decision `false`, no `spec-audited`) | 3 | `performance-plan` |
| `plan-created` present, `implementation-done` absent | 4 | `performance-implement` |
| `implementation-done` present, `options-chosen` absent | 5 | `performance-verify` (asks options) |
| `options-chosen` present, `verification-done` absent | 5 | `performance-verify` (idempotence rule) |
| `verification-done` present, `task-completed` absent | 6 | `performance-finalize` |
| all 9 slugs, `task.status: completed` | T | none — done |
| anomalous (unreachable-by-design, e.g. `SW ∧ SA` with decision `null`; or slugs out of order) | F | `performance-analyze`, with the failing state reported |

Row 2's two-part condition is what makes the audit a first-class routable outcome in **all three** directions: `null` → stays in `performance-spec` to settle the decision; `true` + `spec-audited` missing → routes into the audit sub-step; `false`, or `true` + `spec-audited` present → falls through to row 3.

### Resume Validation — the two-kind table

Applied on every resume, before `completed_phases` is trusted (`gate-contract.md:28`). An entry whose marker is missing is dropped; artifacts beat state.

| Slug | Validated against | Kind |
| --- | --- | --- |
| `codebase-analysed` | `analysis/codebase-analysis.md` | file |
| `bottlenecks-identified` | `analysis/performance-analysis.md` | file |
| `spec-written` | `implementation/spec.md` | file |
| `spec-audited` | `verification/spec-audit.md` | file (conditional) |
| `plan-created` | `implementation/implementation-plan.md` | file |
| `implementation-done` | `implementation/work-log.md` | file |
| `options-chosen` | at least one non-null `orchestrator.options.*` review flag | **state predicate — vacuous, see note** |
| `verification-done` | `verification/implementation-verification.md` | file |
| `task-completed` | `task.status: completed` | **state predicate** |

**The `options-chosen` predicate is vacuous against this template — recorded, not fixed (Known Limitation #11).** The template ships `code_review_enabled: true`, `pragmatic_review_enabled: true` and `reality_check_enabled: true`, so "at least one non-null `options.*` review flag" is true on a **brand-new** state, before the user has chosen anything. The predicate therefore never drops a stale `options-chosen` entry, and the safeguard is delivered by other means: `performance-verify` owns the slug, its Entry Gate routes on the slug itself, and its idempotence rule governs the re-entry. Narrowing the predicate to a value the template cannot pre-satisfy would require a dedicated marker artifact — new scope, and D1 is settled, so it is **recorded as Known Limitation #11** instead. `task-completed`'s predicate (`task.status: completed` against a `pending` default) *does* discriminate and is sound.

---

## Checklist Waivers (routing-only dispatcher)

This dispatcher records explicit, named waivers against [Orchestrator Creation Checklist](../orchestrator-framework/references/orchestrator-creation-checklist.md) items written for a monolith-shaped orchestrator with inline phases; a routing-only dispatcher cannot satisfy them because it executes no phase bodies and delegates nothing:

| Checklist item | Disposition | Why |
| --- | --- | --- |
| `:16` Phase structure (Purpose / Execute / Output / State / Transition per phase) | Waived | No phase bodies here — the 6 subskills own Execute/Output/State, and Entry/Exit Gates own transitions. |
| `:17` Delegation enforcement (ANTI-PATTERN / INVOKE NOW / SELF-CHECK per delegated phase) | Waived | The dispatcher spawns no subagents; delegation blocks live in the subskills that delegate. |
| `:18` POST-CONTINUATION blocks | Waived | No Skill-tool phase runs here; each subskill appends its own slugs. |
| `:19` Context passing (accumulated context in subagent prompts) | Waived by the same clause as `:17` | Unsatisfiable for the same reason: no subagents are spawned here. |
| `:20` Context extraction (per-phase `phase_summaries`) | Waived | Extraction happens per step inside the subskills. |
| `:21` Decision gates (`decisions_needed` presented via `question`) | Waived | The dispatcher receives none; the subskills own their decision questions. |
| `:22` `question` at every `→ Pause` | Waived | No `→ Pause` transitions exist — routing prints one command and STOPS; the explicit invocation is the gate. |
| `:25` Auto-recovery table | Waived | Retries are owned per subskill (each `performance-*` SKILL.md carries its own `## Recovery` table). |
| `:24` TaskCreate initialization | **Satisfied, not waived** | The dispatcher creates the six task items with `addBlockedBy` at init and records their ids in `orchestrator.task_ids`; the wrapper only updates those ids. |

---

## Exit Gate (adapted for dispatch mode)

After deriving the handoff, present the results box, ask how to proceed, then hand off accordingly (see the [dispatcher exception](../orchestrator-framework/references/gate-contract.md)). The results box IS the handoff block. Never auto-invoke the subskill.

### Results box

```markdown
## ✅ PERFORMANCE TASK READY — <task name>

**Task** — [performance issue description]
**Directory** — `<task-path>`
**Next step** — [subskill + slug(s)]
[Resume note: completed steps / fresh task]

**Next ▸** `/owflow:performance-<subskill> <task-path>`
```

### Acceptance question

Use `question` — "Task ready. How would you like to proceed?" with options:

- **Hand off to /owflow:performance-<subskill>** — the user invokes the suggested command (the dispatcher copies it to chat for convenience). Execution starts in a fresh context.
- **Switch to autonomous mode** — run the remaining steps in one session: `/owflow:goal-performance <task-path>`.
- **Adjust** — task set-up or derivation is wrong (wrong description, wrong task, wrong `--from`); re-run the affected step, re-present the results box.
- **Stop here** — print the resume command (`/owflow:performance <task-path>`) and end.

### Handoff message

On Accept (hand off choice), print, then STOP:

```
✓ Performance task ready at <task-path>

Next step:
  → /owflow:performance-<subskill> <task-path>

Other options:
  /owflow:goal-performance <task-path>   — run remaining steps in one loop
  /owflow:performance --from=<step-slug> <task-path>   — jump to a specific step
```

---

## Task Structure

The dispatcher creates the directory skeleton at init; every artifact below is produced by the subskill named in the comments:

```
.owflow/tasks/performance/YYYY-MM-DD-task-name/
├── orchestrator-state.yml                # dispatcher (init) + every subskill (per-step writes)
├── analysis/
│   ├── codebase-analysis.md              # performance-analyze (codebase-analysed)
│   ├── clarifications.md                 # performance-analyze
│   ├── performance-analysis.md           # performance-analyze (bottlenecks-identified)
│   ├── requirements.md                   # performance-spec
│   └── user-profiling-data/              # optional user-provided data
├── implementation/
│   ├── spec.md                           # performance-spec (spec-written)
│   ├── implementation-plan.md            # performance-plan (plan-created)
│   └── work-log.md                       # performance-implement (implementation-done)
└── verification/
    ├── spec-audit.md                     # performance-spec (spec-audited, conditional)
    └── implementation-verification.md    # performance-verify (verification-done)
```

---

## Auto-Recovery

Retries are owned by each subskill (each `/owflow:performance-*` SKILL.md carries its own `## Recovery` table).

---

## Command Integration

Invoked via:

- `/owflow:performance [description]` (new)
- `/owflow:performance [task-path] [--from=<step-slug>]` (resume)

Alternative: `/owflow:goal-performance <task-path>` — same task lifecycle, all subskills invoked in one session with `question` gates.

Task directory: `.owflow/tasks/performance/YYYY-MM-DD-task-name/`
