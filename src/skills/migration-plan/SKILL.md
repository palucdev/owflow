---
name: owflow:migration-plan
description: Migration — delegates implementation planning with a rollback/checkpoint step mandated in every task group, then refines the plan with a diagram (plan-created).
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Plan — Rollback-Guarded Implementation Plan (plan-created)

Work phase of the migration workflow. Delegates planning to the reused `implementation-planner` agent with the migration requirement that **every task group carries a rollback/checkpoint step**, then refines the plan with an execution diagram.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                                                       | Produced by                          |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`                                 | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |
| Strategy specified      | `strategy-specified` in `completed_phases` **and** `implementation/spec.md` exists | `/owflow:migration-spec <task-path>` |
| Rollback plan consumed  | `analysis/rollback-plan.md` exists (source of per-group rollback content) | `/owflow:migration-spec <task-path>` |

### 3. Blocked output

1. Steps that must be completed first (in order), each with its command:
   - Requirements, specification & rollback/dual-run plans (`strategy-specified`) → `/owflow:migration-spec <task-path>`
   - Target state planning (`target-planned`) → `/owflow:migration-target <task-path>` (if also missing)
   - Current-state analysis (`state-analysed`) → `/owflow:migration-analyze <task-path>` (if also missing)
   - State initialization → `/owflow:migration <description>` (new task)
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `plan-created`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-plan (mid-pipeline bootstrap)"`, `orchestrator.started_phase: plan-created`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — `implementation/spec.md` and the rollback plan still block, so bootstrapping never skips upstream work.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `implementation/implementation-plan.md` exists but `plan-created` is missing ⇒ **adopt**: append `plan-created`, backfill `phase_summaries.plan.summary` and `migration_outputs.implementation_plan` where still null.
- `plan-created` is present but `implementation/implementation-plan.md` is missing ⇒ **drop** `plan-created` from `completed_phases` and re-run.
- Both artifact and slug exist ⇒ report the existing plan summary and route to the Exit Gate.
- `analysis/rollback-plan.md` is missing while `strategy-specified` holds ⇒ route back to `/owflow:migration-spec <task-path>` to regenerate the extraction — never re-author it here.

### 6. Conditional activation

Not applicable — `migration-plan` has no activation condition; it runs whenever its prerequisites are met.

### 7. Recovery

| Step                       | Max Attempts | Strategy                                                                                         |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| Implementation planning (`plan-created`) | 2 | Regenerate with the migration constraints restated: a rollback/checkpoint step in every task group and rollback content read from the strategies reference |

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), then read `../migration-spec/references/migration-strategies.md` for the rollback-step content (the rollback-plan structure and strategy patterns).

| Direction | Artifact                            | Producer                                                        |
| --------- | ----------------------------------- | --------------------------------------------------------------- |
| Consumed  | `implementation/spec.md`            | `migration-spec` (approved specification)                       |
| Consumed  | `analysis/rollback-plan.md`         | `migration-spec` (per-group rollback content)                   |
| Produced  | `implementation/implementation-plan.md` | `implementation-planner` (**Task**, frozen contract)        |

### Delegated Planning with Per-Group Rollback (`plan-created`)

> **ANTI-PATTERN — never write `implementation-plan.md` yourself. "The groups are straightforward" is NOT a reason to skip delegation.**

1. **Task tool — `implementation-planner`** (frozen contract). Pass: `task_path`, `task_description`, `migration_context.*` (type, strategy, risk level, breaking changes), `phase_summaries` (spec plus upstream), `implementation/spec.md`, and `analysis/rollback-plan.md` as the rollback source.
2. **Injected requirement**: the delegation prompt **mandates** that every task group carries a rollback/checkpoint step, with rollback-step content read from `../migration-spec/references/migration-strategies.md`. Pass that path and the `analysis/rollback-plan.md` structures explicitly.
3. **SELF-CHECK before the state write**: read `implementation/implementation-plan.md` and confirm every task group ends with a rollback/checkpoint step. If any group is missing one, re-invoke the planner with the requirement restated — do not append the rollback steps yourself.
4. **Skill tool — `diagrams-mermaid`** (content-preserving) on `implementation/implementation-plan.md`: add one migration execution/state flow with rollback checkpoints. The written steps and rollback details remain authoritative; diagrams are explanatory. A skipped or failed refinement is not a failure — note it in `phase_summaries.plan.summary` and continue.
5. **State write**: append `plan-created` to `completed_phases`; set `phase_summaries.plan.summary`, `migration_outputs.implementation_plan`; bump `orchestrator.updated`. On failure: append `plan-created` to `failed_phases`, increment `auto_fix_attempts["plan-created"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`plan-created`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — a failed or abandoned step is NOT appended to `completed_phases`; append its slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION PLAN COMPLETE — <task name>

**Task groups** — [N]
**Total steps** — [M]
**Rollback coverage** — ✅ every task group carries a rollback/checkpoint step
**Execution order** — [key dependencies, 1-2 lines]
**Diagram** — [added / skipped (optional)]

**Artifacts**

- `implementation/implementation-plan.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the plan is good; continue.
- **Adjust** — regenerate the plan with the user's corrections (grouping, ordering, rollback steps), update state, re-present the results box.
- **Discuss** — walk through the task groups, dependencies, or rollback/checkpoint design in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-plan <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:migration-implement <task-path>` — `required` next: executes the plan task group by task group with the per-group rollback/checkpoint steps and writes the work log. Remaining after: verify (→ fix when needed) → finalize.

**Other options**:

- `/owflow:goal-migration <task-path>` — `optional` shortcut: runs all remaining phases in one loop (implement → verify → fix when needed → finalize)

Then STOP.
