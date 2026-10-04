---
name: owflow:migration-target
description: Migration — plans the target state and gap inventory, classifies the migration type, recommends a strategy, and records external research. Owns the risk-lock boundary (target-planned).
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Target — Target State, Type & Risk Lock (target-planned)

Work phase of the migration workflow. Delegates the gap inventory to the reused `gap-analyzer` agent, then authors type classification and strategy recommendation inline from `references/migration-types.md`. The Exit Gate locks target, type, strategy, and breaking changes for the rest of the pipeline — downstream skills treat them as frozen.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                                                              | Produced by                          |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`                                        | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |
| Current state analysed  | `state-analysed` in `completed_phases` **and** `analysis/current-state-analysis.md` exists | `/owflow:migration-analyze <task-path>` |

### 3. Blocked output

1. Steps that must be completed first (in order), each with its command:
   - Current-state analysis (`state-analysed`) → `/owflow:migration-analyze <task-path>`
   - State initialization → `/owflow:migration <description>` (new task)
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `target-planned`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-target (mid-pipeline bootstrap)"`, `orchestrator.started_phase: target-planned`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — `analysis/current-state-analysis.md` still blocks, so bootstrapping never skips upstream work.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `analysis/target-state-plan.md` exists but `target-planned` is missing ⇒ **adopt**: append `target-planned`, backfill `migration_context.{migration_type, target_system, risk_level, breaking_changes}`, `external_research.*`, `phase_summaries.target.summary`, and `migration_outputs.target_state_plan` where still null.
- `target-planned` is present but `analysis/target-state-plan.md` is missing ⇒ **drop** `target-planned` from `completed_phases` and re-run.
- Both artifact and slug exist ⇒ report the existing type/strategy/risk decision and route to the Exit Gate; do not re-ask a settled type.
- The template placeholder `"code | data | architecture | general"` is NOT a settled type — only a real classification or a dispatcher `--type` value is.

### 6. Conditional activation

Not applicable — `migration-target` has no activation condition; it runs whenever its prerequisites are met.

### 7. Recovery

| Step                      | Max Attempts | Strategy                                                                             |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| Target planning (`target-planned`) | 2    | Re-prompt for target details; re-run the gap inventory with the clarified target      |
| Type confirmation         | 1            | Present the detected type with its keyword evidence; fall back to the user's choice   |
| External research         | 1            | Retry with narrower queries; on failure record `external_research.performed: false` and continue — research never blocks |

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), then **read `references/migration-types.md`** (type detection with confidence, per-type research table, per-type verification focus).

**Flags** (documented here because `argument-hint` is not registered): `--type=code|data|architecture|general` is a **default, not an override** — detection still runs and low confidence still asks for confirmation; `--no-web-research` skips the research step and records `external_research.performed: false` truthfully.

| Direction | Artifact                     | Producer                                                        |
| --------- | ---------------------------- | --------------------------------------------------------------- |
| Consumed  | `analysis/current-state-analysis.md` | `migration-analyze`                                     |
| Produced  | `analysis/target-state-plan.md` | `gap-analyzer` (**Task**) + inline path normalization and type/strategy content |

### Target Planning, Type & Risk Lock (`target-planned`)

> **ANTI-PATTERN — never author the gap inventory inline. The gap analysis is delegated; the inline content is only type classification, strategy recommendation, and the research record.**

1. **Task tool — `gap-analyzer`** (frozen contract, gap inventory only). Pass: `task_path`, current-state summary, target description (`task.description` + clarifications), and constraints. The agent hard-codes its output as `analysis/gap-analysis.md`.
2. **Normalize the path**: after the agent returns, rename/move its output to the declared artifact `analysis/target-state-plan.md`.
3. **Type classification** (inline): run the keyword/confidence algorithm from `references/migration-types.md` against the migration description. A dispatcher `--type` value is the starting default, never an override. When confidence < 100% (or the default is ambiguous), use `question` with the detected type and evidence to confirm/adjust. Write `migration_context.migration_type`.
4. **Strategy recommendation** (inline): pick incremental / big-bang / dual-run / phased with the reference decision tree; the rationale belongs in `phase_summaries.target.summary` and the plan artifact — the vestigial `migration_strategy` block stays unwritten.
5. **External research** (unless `--no-web-research`): WebSearch per the per-type research table. Record `external_research.performed`, `.category`, `.breaking_changes`, `.migration_guide_url` — `migration-target` is the declared single writer of the `external_research.*` block. On a deliberate skip record `performed: false` — never leave the block implying research that did not happen.
6. **State write**: append `target-planned` to `completed_phases`; set `migration_context.target_system.description`, `migration_context.target_system.technologies`, `migration_context.risk_level`, `migration_context.breaking_changes`, `external_research.performed`, `external_research.category`, `external_research.breaking_changes`, `external_research.migration_guide_url`, `phase_summaries.target.summary`, `migration_outputs.target_state_plan`; bump `orchestrator.updated`. On failure: append `target-planned` to `failed_phases`, increment `auto_fix_attempts["target-planned"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`target-planned`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — a failed or abandoned step is NOT appended to `completed_phases`; append its slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION TARGET COMPLETE — <task name>

**Target system** — [1-line summary from state]
**Migration type** — [code / data / architecture / general] ([confidence] / user-confirmed / `--type` default)
**Strategy** — [incremental / big-bang / dual-run / phased] — [1-line rationale]
**Risk level** — [low / medium / high] ([N] breaking changes; ⚠ high requires rollback + compatibility testing)
**External research** — [performed: N queries / skipped (`--no-web-research`)]

🔒 **Risk lock** — target system, migration type, strategy, and breaking changes are LOCKED at this gate; changing any of them routes back through `/owflow:migration-target`.

**Artifacts**

- `analysis/target-state-plan.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the locked target is correct; continue.
- **Adjust** — re-run only the affected part (gap inventory, type, strategy, or research), update state and artifact, re-present the results box.
- **Discuss** — walk through the type evidence, strategy rationale, or risk assessment in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-target <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:migration-spec <task-path>` — `required` next: gathers requirements, produces the specification with mandated rollback/dual-run sections, and extracts the standalone plans. Remaining after: plan → implement → verify (→ fix when needed) → finalize.

**Other options**:

- `/owflow:goal-migration <task-path>` — `optional` shortcut: runs all remaining phases in one loop (spec → plan → implement → verify → fix when needed → finalize)

Then STOP.
