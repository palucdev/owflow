---
name: owflow:migration-finalize
description: Migration — authors the operator migration guide inline when enabled, then completes the task. Workflow-terminal (docs-generated optional, task-completed always).
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Finalize — Operator Guide & Task Completion (docs-generated, task-completed)

Terminal work phase of the migration workflow. When `options.docs_enabled` resolves true it authors `documentation/migration-guide.md` **inline** (operator audience, text-first — no `user-docs-generator`, no Playwright, no agent edits); then it always finalizes: workflow summary, `task.status: completed`, and the `task-completed` slug.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                                                                                              | Produced by                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`                                                                        | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |
| Verification done       | `verification-done` in `completed_phases` **and** `verification/implementation-verification.md` exists       | `/owflow:migration-verify <task-path>`           |
| Fix phase settled       | `verification_context.compatibility_status = passed` **and** (`issues-resolved` present with non-empty `fixes_applied` or a recorded approval, **or** `verification_context.last_status = passed`, **or** `phase_summaries.fix.summary` records a deliberate skip) | `/owflow:migration-fix`, `/owflow:migration-verify` |
| Docs toggle known (conditional step) | `options.docs_enabled` in state (`true`/`false`; `null` ⇒ the options gate never ran — treated as not enabled) | `/owflow:migration-verify` (options step) |

### 3. Blocked output

1. Steps that must be completed first (in order), each with its command:
   - Issue resolution (`issues-resolved`) → `/owflow:migration-fix <task-path>` (only when verification left fixable issues)
   - Verification (`verification-done`) → `/owflow:migration-verify <task-path>`
   - Migration execution (`migration-executed`) → `/owflow:migration-implement <task-path>` (if also missing)
   - Implementation planning (`plan-created`) → `/owflow:migration-plan <task-path>` (if also missing)
   - Strategy specification (`strategy-specified`) → `/owflow:migration-spec <task-path>` (if also missing)
   - Target state planning (`target-planned`) → `/owflow:migration-target <task-path>` (if also missing)
   - Current-state analysis (`state-analysed`) → `/owflow:migration-analyze <task-path>` (if also missing)
   - State initialization → `/owflow:migration <description>` (new task)
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `task-completed`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-finalize (mid-pipeline bootstrap)"`, `orchestrator.started_phase: task-completed`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — `verification/implementation-verification.md` still blocks, so bootstrapping never skips upstream work.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `task.status: completed` or `task-completed` in `completed_phases` ⇒ report the existing finalization and STOP — the workflow is terminal; never re-run it.
- `documentation/migration-guide.md` exists but `docs-generated` is missing ⇒ **adopt**: append `docs-generated`, backfill `migration_outputs.migration_guide`, continue to finalization.
- `docs-generated` is present but the guide is missing ⇒ **drop** `docs-generated` and re-author (only when enabled).
- Fix phase unsettled (`compatibility_status != passed` — failed or never written — **or** no `issues-resolved`/approval/skip **and** `last_status != passed`) ⇒ route back to `/owflow:migration-verify <task-path>` (or `/owflow:migration-fix <task-path>` when issues remain) — never finalize unfinished verification. A failed compatibility check is **never waived by a deliberate skip or approval**: re-verify after fixes, or use user-confirmed rollback.
- A settled `options.docs_enabled` is reported, not re-asked.

### 6. Conditional activation

Read `options.docs_enabled` (tri-state). `true` ⇒ run the Documentation step below. `false` **or** `null` (the options gate never settled it) ⇒ report `Operator guide disabled — skipping documentation.` and skip straight to Finalization: **no `docs-generated` slug, no failure entry** — a docs skip is an option value, not a failure. Do not prompt for the toggle here; its setter is `migration-verify`'s options step.

### 7. Recovery

| Step                            | Max Attempts | Strategy                                                                       |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| Documentation (`docs-generated`) | 1           | Generate text-only — inline markdown, no screenshots or tooling                 |
| Finalization (`task-completed`)  | 1           | Compose the summary and set `task.status: completed`; state-only — repeat once, then report |

## Execute

**Read first**: no delegation is used in this skill. **Inline authoring by design**: `user-docs-generator` (hard-codes `documentation/user-guide.md` + Playwright) is explicitly out of scope — never invoke it, Playwright, or any agent for the guide.

| Direction | Artifact                              | Producer                                                    |
| --------- | ------------------------------------- | ----------------------------------------------------------- |
| Consumed  | all `migration_outputs.*` paths       | upstream phases (analysis → verification)                   |
| Consumed  | `verification_context.last_status`, `verification_context.compatibility_status` | `migration-verify` (ownership), `migration-fix` (re-verify refresh) |
| Consumed  | `options.docs_enabled`                | `migration-verify` options step                             |
| Produced  | `documentation/migration-guide.md` (conditional) | inline authoring (this skill)                     |
| Produced  | workflow summary + `task.status: completed` | inline authoring (this skill)                         |

### Operator Migration Guide (`docs-generated`, conditional)

**Skip if** `options.docs_enabled` is not `true` (see part 6 — report and skip; no slug, no failure entry).

Author `documentation/migration-guide.md` directly in the main agent — **operator audience, text-first**. Cover exactly:

1. **Migration overview and goals** — what changed, why, current → target.
2. **Prerequisites and preparation** — access, backups, environment readiness.
3. **Step-by-step procedure** — ordered operator steps from the implementation plan / work log, with the per-group checkpoints.
4. **Rollback procedures** — from `analysis/rollback-plan.md` (authoritative) and `analysis/dual-run-plan.md` when present.
5. **Troubleshooting** — known issues from verification, the compatibility checks, and fix decisions.

**State write**: append `docs-generated`; set `migration_outputs.migration_guide: "documentation/migration-guide.md"`; bump `orchestrator.updated`; re-read + `verify_template`.

### Finalization (`task-completed`, always)

1. **Compose the workflow summary** from state + artifacts: migration type/strategy, steps completed, verification + compatibility outcomes, fixes, guide status. There is no `finalize` key in `phase_summaries` — the omission is deliberate (state-only terminal step); do not add one.
2. **State write**: set `task.status: completed`; append `task-completed`; bump `orchestrator.updated`; re-read + `verify_template`.
3. **Workflow-end handoff**: no further owflow phase is required; list the artifacts for the user's own review and commit (the workflow performs no commits).

## State Update Convention (per step)

1. **Write immediately** — append `docs-generated` only when documentation actually ran, then `task-completed` at finalization; never batch and never append `docs-generated` on a skip or failure.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the guide ultimately fails after the one text-only retry, do NOT append `docs-generated`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["docs-generated"]`; ask the user whether to continue to finalization without docs. A disabled guide is NOT a failure (no entry at all).
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then close the workflow (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION WORKFLOW COMPLETE — <task name>

**Migration** — [current → target, type]
**Strategy** — [incremental / big-bang / dual-run / phased]
**Verification** — [final verifier verdict + overall compatibility verdict]
**Fixes** — [N applied / none required / deliberately skipped]
**Operator guide** — [✅ `documentation/migration-guide.md` / skipped (`docs_enabled` not enabled)]
**Rollback plan** — ✅ `analysis/rollback-plan.md` (user-confirmed rollback only)

**Artifacts**

- `analysis/current-state-analysis.md`
- `analysis/target-state-plan.md`
- `analysis/requirements.md`
- `analysis/rollback-plan.md`
- `analysis/dual-run-plan.md` [conditional]
- `implementation/spec.md`
- `implementation/implementation-plan.md`
- `implementation/work-log.md`
- `verification/implementation-verification.md`
- `verification/compatibility-test-results.md`
- `documentation/migration-guide.md` [conditional]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the migration is complete; show the workflow-end handoff.
- **Adjust** — re-run the affected part (operator guide and/or finalization) with the user's corrections, update state, re-present the results box.
- **Discuss** — walk through the workflow summary, verification outcome, guide contents, or rollback readiness in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-finalize <task-path>`) and end.

### Next steps (after Accept)

**Workflow-end handoff (terminal)** — the migration workflow is finished; no further owflow phase command is required and this skill advances nothing. Remaining: none.

- Review the artifacts above, then commit and open a PR using the operator guide's rollback procedures as the safety reference — `optional` manual step outside owflow (the workflow performs no commits).
- `/owflow:reviews-pragmatic <task-path>` — `optional` — post-migration over-engineering check; does not advance phases.
- `/owflow:standards-update "<lesson learned>"` — `optional` — captures migration learnings as project standards; does not advance phases.

Then STOP.
