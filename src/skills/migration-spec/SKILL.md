---
name: owflow:migration-spec
description: Migration — gathers requirements, delegates the specification with mandated rollback/dual-run sections, extracts the standalone plans, then refines diagrams (strategy-specified).
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Spec — Requirements, Specification & Rollback/Dual-Run Plans (strategy-specified)

Work phase of the migration workflow. Gathers migration requirements inline, delegates specification creation to the reused `specification-creator` agent with **mandated** rollback/dual-run sections, extracts those sections into standalone authoritative artifacts, then refines the spec with diagrams.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                                                            | Produced by                        |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                                      | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |
| Target state locked     | `target-planned` in `completed_phases` **and** `analysis/target-state-plan.md` exists | `/owflow:migration-target <task-path>` |

### 3. Blocked output

1. Steps that must be completed first (in order), each with its command:
   - Target state planning (`target-planned`) → `/owflow:migration-target <task-path>`
   - Current-state analysis (`state-analysed`) → `/owflow:migration-analyze <task-path>` (if also missing)
   - State initialization → `/owflow:migration <description>` (new task)
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `strategy-specified`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-spec (mid-pipeline bootstrap)"`, `orchestrator.started_phase: strategy-specified`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — `analysis/target-state-plan.md` still blocks, so bootstrapping never skips upstream work.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `implementation/spec.md` **and** `analysis/rollback-plan.md` exist but `strategy-specified` is missing ⇒ **adopt**: append `strategy-specified`, backfill `migration_context.{rollback_plan_created, dual_run_configured}`, `phase_summaries.spec.summary`, and the `migration_outputs` paths where still null; run only the missing parts.
- `strategy-specified` is present but `implementation/spec.md` is missing ⇒ **drop** `strategy-specified` from `completed_phases` and re-run.
- `analysis/requirements.md` exists ⇒ adopt it and skip the requirement-questions part when it already covers the topics; `analysis/dual-run-plan.md` exists ⇒ `dual_run_configured: true`.
- Settled `rollback_plan_created` / `dual_run_configured` values are reported, not re-asked.

### 6. Conditional activation

Not applicable — `migration-spec` has no activation condition; the dual-run plan's presence is content-dependent (decided in the requirement questions), not an activation gate.

### 7. Recovery

| Step                                | Max Attempts | Strategy                                                                                     |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| Requirements                        | 2            | Re-gather in one consolidated question round                                                  |
| Specification (`strategy-specified`) | 2           | Re-invoke `specification-creator` with the missing mandated section explicitly demanded        |
| Rollback/dual-run extraction        | 2            | Re-extract verbatim from `implementation/spec.md`; if a mandated section is absent, re-run the delegation step |

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), then **read `references/migration-strategies.md`** (rollback-plan and dual-run-plan structures, strategy selection).

| Direction | Artifact                        | Producer                                                        |
| --------- | ------------------------------- | --------------------------------------------------------------- |
| Consumed  | `analysis/target-state-plan.md` | `migration-target` (locked target, type, strategy)              |
| Produced  | `analysis/requirements.md`      | inline `question` round (3–5 questions)                         |
| Produced  | `implementation/spec.md`        | `specification-creator` (**Task**, frozen contract)             |
| Produced  | `analysis/rollback-plan.md`     | post-delegation verbatim extraction (always)                    |
| Produced  | `analysis/dual-run-plan.md`     | post-delegation verbatim extraction (when dual-run applies)     |

### Requirements, Specification & Extraction (`strategy-specified`)

1. **Requirements gathering (inline)** — use `question` for 3–5 migration-specific questions: scope boundaries, rollback expectations and downtime tolerance, data-migration specifics, dual-run requirements, existing code/config to preserve. Frame as confirmable assumptions. Save to `analysis/requirements.md`.
2. **Project-doc discovery (nothing persisted)** — read `.owflow/docs/INDEX.md` if present, collect the Project Documentation paths as `project_context_paths`, and pass them directly to the delegate. There is no `project_context` state key; do not write one (assumption 8).
3. **Task tool — `specification-creator`** (frozen contract). Pass: `task_path`, `task_description`, `requirements_path` (`analysis/requirements.md`), `project_context_paths`, `migration_context.*` (type, current/target system, risk level, breaking changes), and relevant `phase_summaries`. The prompt **mandates** a `## Rollback Plan` section (always) and a `## Dual-Run Configuration` section (when dual-run applies) inside `implementation/spec.md`.
4. **Post-delegation extraction — before the diagrams step**: as soon as the delegation returns, extract those sections **verbatim** from `implementation/spec.md` into `analysis/rollback-plan.md` (always) and `analysis/dual-run-plan.md` (when present). The standalone artifact is authoritative; the spec section becomes its summary. Never let the diagrams step run first.
5. **Skill tool — `diagrams-mermaid`** (content-preserving) on `implementation/spec.md`: add a target-architecture and transition/compatibility visual as a supplement, never a replacement for strategy prose. Missing context → record open gaps instead of inventing systems.
6. **State write**: append `strategy-specified` to `completed_phases`; set `migration_context.rollback_plan_created: true`, `migration_context.dual_run_configured: true/false`, `phase_summaries.spec.summary`, `migration_outputs.requirements`, `migration_outputs.spec`, `migration_outputs.rollback_plan` (+ `migration_outputs.dual_run_plan` when produced); bump `orchestrator.updated`. On failure: append `strategy-specified` to `failed_phases`, increment `auto_fix_attempts["strategy-specified"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`strategy-specified`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — a failed or abandoned step is NOT appended to `completed_phases`; append its slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION SPEC COMPLETE — <task name>

**Strategy** — [strategy from the locked target / spec]
**Scope** — [N included / M excluded]
**Rollback plan** — ✅ `analysis/rollback-plan.md` (standalone, authoritative)
**Dual-run** — [configured → `analysis/dual-run-plan.md` / not applicable]
**Diagrams** — [added / skipped (optional)]

**Artifacts**

- `analysis/requirements.md`
- `implementation/spec.md` (mandates the Rollback Plan / Dual-Run Configuration sections)
- `analysis/rollback-plan.md`
- `analysis/dual-run-plan.md` [conditional]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the specification and extracted plans are correct; continue.
- **Adjust** — re-run only the affected part (requirements, spec delegation, extraction, diagrams), update state and artifacts, re-present the results box.
- **Discuss** — walk through scope boundaries, the rollback approach, or the dual-run decision in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-spec <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:migration-plan <task-path>` — `required` next: breaks the approved spec into task groups, mandating a rollback/checkpoint step in every group. Remaining after: implement → verify (→ fix when needed) → finalize.

**Other options**:

- `/owflow:goal-migration <task-path>` — `optional` shortcut: runs all remaining phases in one loop (plan → implement → verify → fix when needed → finalize)

Then STOP.
