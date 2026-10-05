---
name: owflow:migration-verify
description: Migration — settles all verification options in one gate, delegates the reused verifier, runs the 4 migration compatibility checks, and owns options-chosen then verification-done.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Migration Verify — Options, Verification & Compatibility Checks (options-chosen, verification-done)

Work phase of the migration workflow. Runs in a **fixed order**: options gate → reused `implementation-verifier` → the 4 migration compatibility checks → `verification-done`. Compatibility checks run **after** the verifier so they consume its verified baseline. Compatibility outcomes are persisted as the `verification_context.compatibility_status` state fact; the Exit Gate itself never mutates phase state.

## Entry Gate

### 1. Argument resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/migrations/` (e.g., `2026-01-12-framework-upgrade`); resolve to its path.
- Missing argument, a path that does **not exist**, or no identifier match → print the blocked block (part 3), then STOP. Never guess or auto-pick a task.

### 2. Prerequisites

| Required for this skill | Where verified                                                       | Produced by                            |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                                 | `/owflow:migration <description>` (dispatcher init) or mid-pipeline bootstrap |
| Migration executed      | `migration-executed` in `completed_phases` **and** `implementation/work-log.md` exists | `/owflow:migration-implement <task-path>` |
| Verifier inputs present | `implementation/implementation-plan.md`, `implementation/spec.md`, **and** `implementation/work-log.md` exist (the reused verifier's required inputs) | `/owflow:migration-plan`, `/owflow:migration-spec`, `/owflow:migration-implement` |

### 3. Blocked output

1. Steps that must be completed first (in order), each with its command:
   - Migration execution (`migration-executed`) → `/owflow:migration-implement <task-path>`
   - Implementation planning (`plan-created`) → `/owflow:migration-plan <task-path>` (if also missing)
   - Strategy specification (`strategy-specified`) → `/owflow:migration-spec <task-path>` (if also missing)
   - Target state planning (`target-planned`) → `/owflow:migration-target <task-path>` (if also missing)
   - Current-state analysis (`state-analysed`) → `/owflow:migration-analyze <task-path>` (if also missing)
   - State initialization → `/owflow:migration <description>` (new task)
2. List available migration-task identifiers (directories under `.owflow/tasks/migrations/`) to resume from, if any.
3. Hint: `Run /owflow:migration <description> to start a migration task from scratch, or pass a task path/identifier to resume.`

Then STOP — never guess or auto-pick a task.

### 4. Missing-state bootstrap

When the only unmet prerequisite is the state file, use `question` — "No task exists at this path. Create a fresh standard migration task and start at `options-chosen`?" with **Create task** / **Decline**.

- **On confirm**: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template with `orchestrator.entry_point: "migration-verify (mid-pipeline bootstrap)"`, `orchestrator.started_phase: options-chosen`, `completed_phases: []`, `task.title`/`task.description` from the argument. Run `verify_template` (`orchestrator-state-migration.yml`) immediately. Creates state ONLY — `implementation/work-log.md` still blocks, so bootstrapping never skips upstream work.
- **On decline**: print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

### 5. Skip/resume — artifacts before state

- `verification/implementation-verification.md` exists but `verification-done` is missing ⇒ **adopt**: do not re-run the verifier; backfill `verification_context.last_status` and `verification_context.issues_found` from the report summary, continue at the compatibility checks, then append `verification-done`.
- `verification-done` is present but `verification/implementation-verification.md` is missing ⇒ **drop** `verification-done` from `completed_phases` and re-run.
- `options-chosen` is present with settled `options.*` values ⇒ never re-ask; report the existing decision and continue at the verifier step (or route to the Exit Gate when `verification-done` is also present).
- Re-verification (`options-chosen` + `verification-done` already complete, invoked after fixes) ⇒ confirm scope via `question` — full re-run vs only failed checks.
- A `null` option key is unsettled — include it in the options gate; a `null` tri-state `docs_enabled` means the options gate has not run yet.

### 6. Conditional activation

Not applicable — `migration-verify` runs whenever its prerequisites are met. (Its own outputs activate the downstream conditionals: `migration-fix` and `migration-finalize`.)

### 7. Recovery

| Step                            | Max Attempts | Strategy                                                                                                                                          |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Options gate (`options-chosen`) | 1            | Re-present one consolidated gate; all 7 keys settle together                                                                                       |
| Verification (`verification-done`) | 3         | Fix-then-reverify (max 3 cycles). **HALT on data integrity**: a failed data-integrity check is never auto-fixed — record ❌ with evidence and recommend rollback (explicit user confirmation required) |

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), then read `../migration-spec/references/migration-strategies.md` (compatibility and rollback/dual-run testing content) and `../migration-target/references/migration-types.md` (per-type verification focus).

| Direction | Artifact                                    | Producer                                                          |
| --------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Consumed  | `implementation/implementation-plan.md`, `implementation/work-log.md` | `migration-plan`, `implementation-plan-executor`      |
| Consumed  | `analysis/rollback-plan.md`, `analysis/dual-run-plan.md` (conditional) | `migration-spec`                               |
| Produced  | `verification/implementation-verification.md` | `implementation-verifier` (**Skill**, reused 0 changes)         |
| Produced  | `verification/compatibility-test-results.md` | inline compatibility checks (direct, no delegation)              |

**Fixed order — do not reorder: (1) options gate → (2) `implementation-verifier` → (3) compatibility checks → (4) `verification-done`.**

### 1. Verification Options (`options-chosen`, inline)

**Step 1** — display the plan:

```
Verification Plan:
  Obligatory (always run):
    ✓ Completeness check
    ✓ Test suite (skipped — passed during implementation; re-enabled after fixes)
  Recommended (adjustable):
    ✓ Code review — quality and security analysis
    ✓ Pragmatic review — detects over-engineering
    ✓ Reality check — validates the migration solves the problem
    ✓ Production readiness — deployment readiness checks
  Conditional:
    [✓/—] Operator migration guide — [reason]
```

**Step 2 — one consolidated gate** (2 `question`s, all 7 keys settle together):

- **Q1** (always): `question` (multi-select) — "Which standard verifications to run?" Options: "Code review (Recommended)", "Pragmatic review (Recommended)", "Reality check (Recommended)", "Production readiness (Recommended)". All pre-selected.
- **Q2** (always): "Generate the operator migration guide in `migration-finalize`?" — "Yes" / "No, skip".

Set **all 7** `options.*` keys in one state write: `code_review_enabled`, `pragmatic_review_enabled`, `reality_check_enabled`, `production_check_enabled` from Q1; `code_review_scope: "all"` when code review is enabled, else `null`; `skip_test_suite: true` (**auto-set** — the full suite passed during implementation; `migration-fix` resets it to `false` after code changes); `docs_enabled` from Q2 (tri-state: `null` only before this gate; never left `null` afterwards).

**State write**: append `options-chosen`; write all 7 `options.*` keys; bump `orchestrator.updated`; re-read + `verify_template`. **This write happens BEFORE the verifier runs** — the verifier reads its flags from state, and `null` keys make it warn-and-prompt once per key.

### 2. Delegate Verification (first `verification-done` step)

Skill tool — `implementation-verifier` (reused, 0 changes). Pass: `task_path`, `task_description`, the chosen options, and `verification_context` when re-verifying. It is read-only (reports, never fixes) and writes `verification/implementation-verification.md`; capture its structured output (`status`, `issues[]`, `issue_counts`).

**Write immediately**: `verification_context.last_status` (`passed` / `passed_with_issues` / `failed`), `verification_context.issues_found` (aggregate counts), `migration_outputs.implementation_verification`; bump `orchestrator.updated`; re-read + `verify_template`. **Do not run the compatibility checks before this write** — they consume this verified baseline.

### 3. Migration Compatibility Checks (`compatibility-test-results.md`, inline)

Author the 4 checks directly (no delegation). Record each check's **Status (Pass / Fail / Not-applicable)**, **Evidence**, and notes; a not-applicable check is recorded explicitly, never silently omitted; close with an overall compatibility verdict.

1. **Dual-run liveness** — the old system still works while dual-run is configured. Read `migration_context.dual_run_configured`; `false` ⇒ **Not-applicable** (recorded explicitly). `true` ⇒ verify both systems stay live and synchronized per `analysis/dual-run-plan.md`.
2. **Non-destructive rollback test** — exercise the `analysis/rollback-plan.md` procedures in a non-production or isolated context **without destroying current state**; verify the documented validation criteria and time estimate.
3. **Data integrity** — for data migrations (and any migration that moves/transforms data): 100% row-count, checksum, and business-rule validation against the verified baseline (per-type focus: data). Failure is a **HALT-class result**: record ❌ with evidence, never auto-fix, never retry into a pass; recommend rollback (explicit user confirmation required).
4. **Before/after performance** — baseline comparison of key metrics before vs after; for code/architecture types this also carries the per-type focus (functional equivalence / system-level behavior).

Write `verification/compatibility-test-results.md`; then write `migration_outputs.compatibility_test_results`, `phase_summaries.verify.summary`, and `verification_context.compatibility_status` — `passed` when no check is ❌, `failed` when any check is ❌ (⚠ concerns do not block) — bump `orchestrator.updated`; re-read + `verify_template`. `compatibility_status` is the persisted overall check verdict consumed by the `migration-fix` / `migration-finalize` gates; it is a check result written during Execute, never an Exit-Gate mutation.

### 4. Complete Verification (`verification-done`)

Append `verification-done` only once the verifier AND all 4 compatibility checks have run. ⚠/❌ verdicts are results shown in the results box; they are **never Exit-Gate state mutations** — the state facts are `verification_context.last_status`, `issues_found`, `compatibility_status`, and the compatibility report. If the verifier itself cannot run or report, do NOT append; use `failed_phases` + `auto_fix_attempts["verification-done"]`.

## State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as each step completes: options after the options gate (before the verifier); `last_status`/`issues_found` right after the verifier (before the checks); `compatibility_status` + the compatibility paths after the checks; `verification-done` last. Never batch.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — a failed or abandoned step is NOT appended to `completed_phases`; append its slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-migration.yml`. Fix any reported issue immediately.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ MIGRATION VERIFY COMPLETE — <task name>

**Verifier status** — [✅ passed / ⚠ passed_with_issues / ❌ failed]
**Issues found** — [N] ([C] critical / [W] warning / [I] info)
**Compatibility checks** — dual-run [✅ / — N/A] · rollback [✅ / ❌] · data integrity [✅ / ❌ / N/A] · performance [✅ / ⚠ / ❌]
**Overall compatibility** — [✅ compatible / ⚠ compatible with concerns / ❌ not compatible]
**Data integrity** — [✅ verified / ❌ HALT — recommend user-confirmed rollback]
**Options** — code review [on/off] · pragmatic [on/off] · production [on/off] · reality [on/off] · operator guide [yes/no]

**Artifacts**

- `verification/implementation-verification.md`
- `verification/compatibility-test-results.md`
- `verification/code-review-report.md`, `verification/pragmatic-review.md`, `verification/production-readiness-report.md`, `verification/reality-check.md` [each if run]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the verification outcome is good (including an approved proceed-with-warnings); continue.
- **Adjust** — run additional fixes and/or another verification round within the max-3 contract, update state and artifacts, re-present the results box.
- **Discuss** — walk through specific findings (issue details, compatibility evidence, data-integrity status) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:migration-verify <task-path>`) and end.

### Next steps (after Accept)

Render ONLY the row whose condition matches the state; list the other branch under Other options:

- `→ /owflow:migration-fix <task-path>` — `required` — only when `verification_context.compatibility_status = failed` **or** (`verification_context.last_status != passed` and no recorded deliberate skip): resolves issues with the data-integrity HALT and re-verifies (max 3 iterations). Remaining after: finalize.
- `→ /owflow:migration-finalize <task-path>` — `required` — only when `compatibility_status = passed` **and** the fix phase is settled (`last_status = passed`, or `issues-resolved`/approval, or a recorded deliberate skip): author the operator guide when enabled, then complete the task. Remaining after: none — workflow ends.

**Other options**:

- The branch not rendered above (`migration-fix` when the finalize condition holds, or `migration-finalize` when fix is required)
- `/owflow:migration-verify <task-path>` — `optional` — re-verification after fixes: re-runs the verifier and the 4 compatibility checks (settles `last_status` and `compatibility_status`; confirm full re-run vs only failed checks)
- `/owflow:goal-migration <task-path>` — `optional` shortcut: runs all remaining phases in one loop (fix when needed → finalize)

Then STOP.
