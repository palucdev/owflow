---
name: owflow:migration-analyze
description: Migration — analyzes the current system and resolves migration-scoped clarifications. First work phase of the migration workflow (state-analysed).
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Analyze — Current State & Clarifications (state-analysed)

Work phase of the migration workflow. Runs current-system analysis via the reused `codebase-analyzer` engine, then resolves migration-scoped clarifications. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Assisted entry point: `/owflow:migration` (dispatcher). Autonomous: `/owflow:goal-migration` (wrapper). Both produce the same state; the modes can be mixed freely.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                     | Produced by                                                  |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml` | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |

No upstream migration slug is required — this is the pipeline's first work phase.

### 3. Blocked output

1. Steps that must be completed first (in order): **none** — `migration-analyze` is the first work phase. If no task exists yet, initialize one with `/owflow:migration <description>`.
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `state-analysed`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-analyze (mid-pipeline bootstrap)"`, `orchestrator.started_phase: state-analysed`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — never upstream artifacts.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `analysis/current-state-analysis.md` exists but `state-analysed` is missing ⇒ **adopt**: append `state-analysed`, backfill `migration_context.current_system`, `migration_context.clarifications_resolved`, `phase_summaries.analyze.summary`, and both `migration_outputs` paths where still null; run only the missing clarifications part.
- `state-analysed` is present but `analysis/current-state-analysis.md` **or** `analysis/clarifications.md` is missing ⇒ **drop** `state-analysed` from `completed_phases` and re-run only the missing part (re-adopt the existing analysis when it is present; never redo the analysis needlessly).
- Both artifacts exist and the slug is present ⇒ report the existing results and route to the Exit Gate.
- `migration_context.clarifications_resolved` is already non-null ⇒ report the existing clarifications instead of re-asking.

### 6. Conditional activation

Not applicable — `migration-analyze` has no activation condition; it runs whenever its state-file prerequisite is met.

### 7. Recovery

| Step                     | Max Attempts | Strategy                                                                                          |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| Analysis (`state-analysed`) | 2         | Expand search patterns across the repository; prompt the user for specific file paths              |
| Clarifications           | 1            | Ask remaining questions in one consolidated round; record unresolved points as explicit assumptions |

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) and the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md).

| Direction | Artifact                            | Producer                                                        |
| --------- | ----------------------------------- | --------------------------------------------------------------- |
| Consumed  | `orchestrator-state.yml`            | dispatcher init / mid-pipeline bootstrap                        |
| Produced  | `analysis/current-state-analysis.md` | `codebase-analyzer` (**Skill**, reused 0 changes) — pass `artifact_name` |
| Produced  | `analysis/clarifications.md`        | inline `question` round (≤5 questions)                          |

### Current-State Analysis & Clarifications (`state-analysed`)

1. **Skill tool — `codebase-analyzer`** (never inline). Pass: `task_path`, `task_description`, and `artifact_name: "current-state-analysis.md"` (the engine derives the `analysis/` prefix — do not pass a path). The engine's migration-target role is documented in its own mapping — do not restate it here.
2. **Inline clarifications** — use `question` for up to 5 migration-scoped questions: migration scope/boundaries, current vs target system, constraints, data involvement, downtime tolerance. Frame as confirmable assumptions ("I assume X — is that correct?"). Save to `analysis/clarifications.md`.
3. **State write**: append `state-analysed` to `completed_phases`; set `migration_context.current_system.description`, `migration_context.current_system.technologies` (**corrected write** — the monolith wrote the undeclared `task_context`), `migration_context.clarifications_resolved: true`, `phase_summaries.analyze.summary`, `migration_outputs.current_state_analysis`, `migration_outputs.clarifications`; bump `orchestrator.updated`. On failure: append `state-analysed` to `failed_phases`, increment `auto_fix_attempts["state-analysed"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`state-analysed`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — a failed or abandoned step is NOT appended to `completed_phases`; append its slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION ANALYZE COMPLETE — <task name>

**Current system** — [1-line summary from state]
**Migration scope** — [included / excluded summary]
**Clarifications** — [N resolved / open assumptions]
**Analysis confidence** — ✅ solid / ⚠ open gaps recorded

**Artifacts**

- `analysis/current-state-analysis.md`
- `analysis/clarifications.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the analysis is good; continue.
- **Adjust** — re-run only the affected part (analysis or clarifications), update state and artifacts, re-present the results box.
- **Discuss** — walk through the current-system findings or scope assumptions in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-analyze <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:migration-target <task-path>` — `required` next: locks the target state, classifies the migration type, recommends a strategy, and produces the risk-locked target-state plan. Remaining after: spec → plan → implement → verify (→ fix when needed) → finalize.

**Other options**:

- `/owflow:goal-migration <task-path>` — `optional` shortcut: runs all remaining phases in one loop (target → spec → plan → implement → verify → fix when needed → finalize)

Then STOP.
