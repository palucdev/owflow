---
name: owflow:performance-verify
description: Performance — verification options prompt, comprehensive implementation verification, and user-driven fix loop. Continues with performance-finalize.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Performance Verify — Verification Options & Issue Resolution (options-chosen, verification-done)

Work step of the performance workflow. Lets the user pick which additional verification checks run, writes the chosen `options.*` to state BEFORE verification starts, then delegates comprehensive verification with a fix-then-reverify loop. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/performance/` (e.g., `2026-10-02-api-latency`); resolve to its path.
- **Description** — anything else (free text) is treated as a new performance task description: ask via `question` whether to start a fresh standard task at this step (mid-pipeline bootstrap) or route through `/owflow:performance <description>`; on decline, print the blocked block and STOP.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - Codebase & bottleneck analysis (`codebase-analysed`, `bottlenecks-identified`) → `/owflow:performance-analyze <task-path>`
   - Requirements, specification & conditional audit (`spec-written`, `spec-audited`) → `/owflow:performance-spec <task-path>`
   - Implementation planning (`plan-created`) → `/owflow:performance-plan <task-path>`
   - Implementation (`implementation-done`) → `/owflow:performance-implement <task-path>`
2. List available performance-task identifiers (directories under `.owflow/tasks/performance/`) to resume from, if any.
3. Hint: `Run /owflow:performance <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                                       | Produced by                               |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                                 | `/owflow:performance <desc>`              |
| Implementation done     | `implementation-done` in `completed_phases` + `implementation/work-log.md` exists | `/owflow:performance-implement <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `options-chosen`): `question` — create a fresh standard performance task starting at this step, or decline → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
2. **Skip/resume + options idempotence rule**: if `options-chosen` is in `completed_phases` AND at least one `orchestrator.options.*` review flag is non-null, the options are already chosen — report them and route straight to the verification-done step; do NOT re-ask. If `verification-done` is also complete (validated against `verification/implementation-verification.md`), report existing results and route to the Exit Gate; if that artifact is missing, drop `verification-done` and re-run verification.
3. **Prerequisite check (presence and content)**: `implementation-done` in `completed_phases` AND `implementation/work-log.md` exists. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: implementation (`implementation-done`).
   - `Run /owflow:performance-implement <task-path> first` (or the command for the earliest missing earlier step: `/owflow:performance-analyze`, `/owflow:performance-spec`, or `/owflow:performance-plan`).
   - If no task exists yet: `Run /owflow:performance <description> to start a task from scratch.`

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) and [Issue Resolution](../orchestrator-framework/references/orchestrator-patterns.md) (Section 6).

### Verification Options (`options-chosen`, inline)

**Step 1**: Display the verification plan:

```
Verification Plan:
  Obligatory (always run):
    ✓ Completeness check
    ✓ Test suite (skipped — passed during implementation; re-enabled after fixes)

  Recommended (adjustable):
    ✓ Code review — quality and security analysis
    ✓ Pragmatic review — detects over-engineering
    ✓ Reality check — validates the optimization solves the problem
    ✓ Production readiness — deployment readiness checks
```

**Step 2**: `question` (multi-select) — "Which additional verification checks?" Options, pre-selected from state where non-null: "Code review (Recommended)", "Pragmatic review (Recommended)", "Reality check (Recommended)", "Production readiness (Recommended)".

**Step 3**: Write the chosen flags to `orchestrator.options.*` (`code_review_enabled`, `pragmatic_review_enabled`, `reality_check_enabled`, `production_check_enabled`) and auto-set `skip_test_suite: true` (safe ONLY because `implementation-plan-executor` already ended with a full test-suite run; it is cleared before re-verification if fixes are applied). **WRITE `options.*` BEFORE the verification step below invokes `implementation-verifier`** — the verifier reads these flags from state and executes them without re-prompting; this is the one ordering constraint it cannot recover from.

**State write**: append `options-chosen` to `completed_phases`; write the chosen `options.*` and `skip_test_suite`; bump `orchestrator.updated`; re-read + `verify_template` (see State Update Convention).

### Verification & Issue Resolution (`verification-done`)

**Step 1**: **INVOKE NOW** (Skill tool — never the Task tool; this skill spawns its own subagents): Skill tool - `implementation-verifier`. Pass: task_path, task_description, the chosen verification options, and `verification_context` if re-verifying. The verifier reads `options.*` from state and executes the enabled reviews without re-prompting.

**SELF-CHECK**: Did you just invoke the Skill tool with `implementation-verifier`? Or did you start running checks yourself? If the latter, STOP and invoke the Skill tool.

**Step 2**: Display the detailed issue breakdown grouped by category and severity:

```
Verification Results:
  Critical ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
  Warning ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
  Info ([N]):
    - [description] (listed for awareness, not actionable)
```

**Step 3**: Gate on status — `passed` → skip to the state write. `passed_with_issues` or `failed` → fix loop (Step 4).

**Step 4**: User-driven fix loop (max 3 iterations):

1. Present critical + warning issues as a numbered list.
2. `question` — "Which issues should I fix?" Options: "Fix all fixable issues" / "Let me choose specific issues" / "Skip fixes, proceed as-is".
3. Fix the selected issues; **immediately** log each to `verification_context.fixes_applied` in state (not deferred to the end).
4. After fixes: set `skip_test_suite: false` (code changed, tests must re-run).
5. `question` — "Re-run verification to check fixes?" → re-invoke `implementation-verifier` → back to Step 2, or "No, proceed to next step".
6. **Immediately** update `verification_context.reverify_count` and `verification_context.last_status` in state after each verifier run and after each fix-loop iteration.

**Exit conditions**: no critical issues remain → proceed; the user explicitly chooses to proceed with issues → proceed with issues logged; max 3 iterations → `question` "Proceed with known issues?" / "Stop workflow". **MUST NOT proceed with unresolved critical issues unless the user explicitly approves.**

**State write**: append `verification-done` to `completed_phases` only at skill exit — status `passed`, or user-approved proceed with issues logged. Bump `orchestrator.updated`. On failure: append `verification-done` to `failed_phases`, increment `auto_fix_attempts["verification-done"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed plus that step's fields. Never defer writes to the end of the skill:
   - Append `options-chosen` with the chosen `options.*` and `skip_test_suite` right after the options prompt, before verification starts.
   - Append `verification-done` only at skill exit: status `passed`, or user-approved proceed with issues logged.
   - Update `verification_context.last_status`, `issues_found`, `fixes_applied`, and `reverify_count` immediately after each `implementation-verifier` run and after each fix-loop iteration, so an interruption loses nothing.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if `implementation-verifier` itself fails or the workflow stops with unresolved critical issues, do NOT append `verification-done` to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["verification-done"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-performance.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                                          | Max Attempts | Strategy                                                                                  |
| --------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Verification Options (`options-chosen`)       | 1            | Re-ask the multi-select once if the answer is unusable; the recommended defaults stay      |
| Verification & Issue Resolution (`verification-done`) | 3    | Fix-then-reverify cycles; after 3 iterations ask the user to proceed with known issues or stop |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ PERFORMANCE VERIFY COMPLETE — <task name>

**Overall status** — [✅ passed / ⚠ passed_with_issues / ❌ failed]
**Issues found** — [total] ([critical] C / [warning] W / [info] I)
**Fixed** — [count]
**Remaining** — [by severity]

**Artifacts**

- `verification/implementation-verification.md`
- `verification/code-review-report.md` [if run]
- `verification/pragmatic-review.md` [if run]
- `verification/reality-check.md` [if run]
- `verification/production-readiness-report.md` [if run]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — verification outcome is good (including approved proceed-with-issues); continue.
- **Adjust** — run additional fixes and/or another verification round (within the fix-loop limits), then re-present the results box.
- **Discuss** — walk through specific findings (issue details, fixability assessment, measurement caveats) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:performance-verify <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:performance-finalize <task-path>` — `required` to close the workflow: final summary, commit guidance, and post-completion measurement hints. Remaining after: none — workflow ends.

**Other options**:

- `/owflow:reviews-code <task-path>` / `/owflow:reviews-pragmatic <task-path>` — `optional` — standalone re-runs of individual reviews; do not advance phases
- `/owflow:goal-performance <task-path>` — `optional` shortcut: finishes the remaining step in one loop (finalize)

Then STOP.
