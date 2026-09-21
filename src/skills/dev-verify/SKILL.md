---
name: owflow:dev-verify
description: Development — verification options prompt, comprehensive implementation verification, and user-driven fix loop.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Verify — Verification & Issue Resolution (options-chosen, verification-done)

Work phase of the development workflow. Lets the user pick which verification checks run, then delegates comprehensive verification with a fix-then-reverify loop.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Codebase & gap analysis (`codebase-analysed`, `gap-analysed`) → `/owflow:dev-analyze <task-path>`
     - TDD red gate (`tdd-red-proven`) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Requirements, specification & audit (`spec-written`, `spec-audited`) → `/owflow:dev-spec <task-path>`
     - Implementation planning (`plan-created`) → `/owflow:dev-plan <task-path>`
     - Implementation & TDD green gate (`implementation-done`, `tdd-green-proven`) → `/owflow:dev-implement <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                   | Produced by                          |
| ----------------------- | ------------------------------------------------ | ------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`             | `/owflow:development <desc>`         |
| Implementation done     | `implementation-done` in `completed_phases`      | `/owflow:dev-implement <task-path>`  |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Prerequisite check**: `implementation-done` in `completed_phases` (implementation done). If missing → print the blocked block, then STOP:
   - Steps that must be completed first: analysis (`codebase-analysed`, `gap-analysed`) → TDD red gate (`tdd-red-proven`, only when a reproducible defect was detected) → specification (`spec-written`) → implementation planning (`plan-created`) → implementation (`implementation-done`).
   - `Run /owflow:dev-implement <task-path> first` (or the command for the earliest missing earlier step: `/owflow:dev-analyze`, `/owflow:dev-tdd-red`, `/owflow:dev-spec`, or `/owflow:dev-plan`).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`
3. **Re-verification**: if `options-chosen` and `verification-done` are already complete and re-running after fixes, confirm scope via `question` (full re-run vs only failed checks).

## Execute

**Read first**: Section 1 (Delegation Rules) and Section 6 (Issue Resolution) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Verification Options Prompt (`options-chosen`, inline)

**Step 1**: Display the verification plan:

```
Verification Plan:
  Obligatory (always run):
    ✓ Completeness check
    ✓ Test suite (skipped — passed during implementation; re-enabled after fixes)

  Recommended (adjustable):
    ✓ Code review — quality and security analysis
    ✓ Pragmatic review — detects over-engineering
    ✓ Reality check — validates work solves the problem
    ✓ Production readiness — deployment readiness checks

  Conditional:
    [✓/—] E2E browser testing — [reason]
    [✓/—] User documentation — [reason]
```

**Step 2** (3 questions):

- **Q1** (always): `question` (multi-select) — "Which standard verifications to run?" Options: "Code review (Recommended)", "Pragmatic review (Recommended)", "Reality check (Recommended)", "Production readiness (Recommended)". All pre-selected.
- **Q2** (skip if `options.e2e_enabled: false` and no `--e2e` flag): "Enable E2E browser verification?" — "Yes (Recommended)" / "No, skip".
- **Q3** (skip if `options.user_docs_enabled: false` and no `--user-docs` flag): "Generate user documentation?" — "Yes (Recommended)" / "No, skip".

Set all chosen `options.*` in state. **Auto-set** `skip_test_suite: true` (full suite passed during implementation; cleared before re-verification if fixes are applied).

**State write**: append `options-chosen` to `completed_phases`; write chosen `options.*` and `skip_test_suite`; bump `orchestrator.updated`; re-read + `verify_template` (see State Update Convention).

### Verification & Issue Resolution (`verification-done`)

**Step 1**: Skill tool - `implementation-verifier`. Pass: task_path, task_description, chosen verification options, `verification_context` if re-verifying.

**Step 2**: Display detailed issue breakdown grouped by category and severity:

```
Verification Results:
  Critical ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
  Warning ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
  Info ([N]):
    - [description] (listed for awareness, not actionable)
```

**Step 3**: Gate on status — `passed` → skip to State Update. `passed_with_issues` or `failed` → fix loop (Step 4).

**Step 4**: User-driven fix loop (max 3 iterations):

1. Present critical + warning issues as a numbered list.
2. `question` — "Which issues should I fix?" Options: "Fix all fixable issues" / "Let me choose specific issues" / "Skip fixes, proceed as-is".
3. Fix selected issues; **immediately** log each to `verification_context.fixes_applied` in state (not deferred to the end).
4. After fixes: set `skip_test_suite: false` (code changed, tests must re-run).
5. `question` — "Re-run verification to check fixes?" → re-invoke `implementation-verifier` → back to Step 2, or "No, proceed to next phase".
6. **Immediately** update `verification_context.reverify_count` and `verification_context.last_status` in state after each verifier run.

**Exit conditions**: no critical issues remain → proceed; user explicitly chooses to proceed with issues → proceed with issues logged; max 3 iterations → `question` "Proceed with known issues?" / "Stop workflow". **MUST NOT proceed with unresolved critical issues unless the user explicitly approves.**

## State Update Convention (per step)

Apply after EVERY phase/step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed plus that step's fields. Never defer writes to the end of the skill.
2. **Options prompt** — append `options-chosen` to `completed_phases` with the chosen `options.*` and `skip_test_suite` (written right after the options prompt, before verification starts).
3. **Per verifier run** — update `verification_context.last_status`, `issues_found`, `fixes_applied`, and `reverify_count` immediately after each `implementation-verifier` run and after each fix-loop iteration (per steps 3/6 above), so an interruption loses nothing.
4. **Completion** — append `verification-done` to `completed_phases` only at skill exit: status `passed`, or user-approved proceed with issues logged. Bump `orchestrator.updated` on every write.
5. **Failures** — if `implementation-verifier` itself fails or the workflow stops with unresolved critical issues, do NOT append `verification-done` to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["verification-done"]`.
6. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
7. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then hand off (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ DEV VERIFY COMPLETE — <task name>

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
- **Discuss** — walk through specific findings (issue details, fixability assessment, recommendations) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-verify <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:dev-finalize <task-path>` — `required` to close the workflow: conditional E2E verification, optional user documentation, and commit guidance (whether E2E/docs run is decided inside based on task characteristics). Remaining after: none — workflow ends.

**Other options**:

- `/owflow:reviews-code <task-path>` / `/owflow:reviews-pragmatic <task-path>` — `optional` — standalone re-runs of individual reviews; do not advance phases
- `/owflow:goal-development <task-path>` — `optional` shortcut: finishes the remaining phases in one loop (finalize)

Then STOP.
