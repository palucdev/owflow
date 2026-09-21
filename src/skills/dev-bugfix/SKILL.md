---
name: owflow:dev-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation. Alternative entry point into the dev-* workflow — creates/resumes a standard development task.
argument-hint: "[bug description | task-path-or-identifier]"
user-invocable: true
---

# Dev Bug Fix

Lightweight TDD-driven bug fix workflow with planning mode. Analyze the bug, present a fix plan for approval, then reproduce with a failing test, fix, and verify. Direct execution — no subagents — but with a **standard** development state file, so the task is a first-class development task: continuable by any dev-* subskill (`/owflow:dev-verify`, `/owflow:development <task-path>`, …) after the fix.

Dev-bugfix is an **alternative entry point** into the development workflow, parallel to `/owflow:dev-implement --quick`: it runs an accelerated, bug-shaped slice of the pipeline (condensed analysis + plan → TDD red → fix → TDD green) and records the same state slugs so downstream skills can pick the task up. It does NOT introduce a second state format.

For complex bugs that grow beyond a quick fix, suggests escalating to the full development workflow (`/owflow:development`).

Gates follow the shared contract in `../orchestrator-framework/references/orchestrator-patterns.md` Section 9.

## Usage

```bash
/owflow:dev-bugfix "Login form submits twice on slow connections"
/owflow:dev-bugfix "API returns 500 when email contains special characters"
/owflow:dev-bugfix .owflow/tasks/development/2026-05-28-login-double-submit
```

Two invocation modes:

| Mode                            | Argument                                   | Result                                                                                                     |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Standalone** (new task)       | Bug description (or nothing — prompt)      | Bootstrap a NEW standard development task, run the quick fix slice, task remains continuable by any dev-*   |
| **Consecutive run** (existing)  | Task path / identifier under `.owflow/tasks/development/` | Fix a newly emerging problem on an existing development task; reuse the task dir and state     |

## Entry Gate

Resolve the argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path / identifier** of an existing task directory under `.owflow/tasks/development/` → **Consecutive-run mode** below. Never guess or auto-pick a task.
- **Description** (quoted free text) → **Standalone mode** below.
- **Missing argument** → scan the recent conversation for bug context (error messages, reproduction steps, discussed symptoms); if found, use that as the bug description. Only if no argument AND no bug context in session, use `question`:

  ```
  "Describe the bug — what's the expected behavior vs actual behavior?"
  (or type a task path to fix a bug on an existing development task)
  ```

  Then re-route by the answer's kind. Stop only when no bug context or task reference can be obtained after asking.

### Standalone mode (new task from scratch)

1. **Create Task Directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` — 3–5 key words from the bug description, lowercase kebab-case, today's date prefix (e.g. "Login form submits twice" → `2026-05-28-login-double-submit`). Create `analysis/` and `implementation/` subdirectories.
2. **Initialize State**: create `orchestrator-state.yml` from the development template with:
   - `task.title` / `task.description` from the bug description, `task.status: in_progress`
   - `orchestrator.entry_point: "dev-bugfix"`
   - `task_context.task_characteristics.has_reproducible_defect: true`
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-development.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists) and extract the Project Documentation file paths into `project_context.project_doc_paths` (matching the development dispatcher's initialization). If `.owflow/docs/` does not exist, proceed without standards and note the graceful-fallback hint (bottom of this file) in the completion message.

### Consecutive-run mode (existing development task)

Used when a bug emerges on a task that already progressed in the dev pipeline (after implementation, verification, or finalization).

1. **Read `orchestrator-state.yml`** from the task path. If missing or the path matches no identifier → print `No development task found at <path>. Run /owflow:dev-bugfix "<description>" to fix a bug on a fresh task.` and STOP.
2. **Read the existing state**: `completed_phases`, `phase_summaries`, affected files from prior phases. The bug fix is APPENDED to the task — existing artifacts (analysis, spec, plan, work-log) stay intact.
3. Continue with the normal workflow below. On success, the fix slugs re-map the task back toward verification (see Downstream Reset in the State Update Convention).

---

## When to Use

**Use `/owflow:dev-bugfix` when:**

- Bug is reasonably scoped and reproducible
- You have a clear description of expected vs actual behavior
- Fix likely touches a small number of files

**Use `/owflow:development` instead when:**

- Bug requires architectural changes
- Multiple subsystems are involved
- You need formal specification and planning

---

## Workflow

### Step 1: Parse Input

Handled by the Entry Gate above — description → standalone bootstrap, task path/identifier → consecutive-run mode.

### Step 2: Standards Discovery

**CRITICAL: This step MUST complete before entering plan mode.**

**Check if `.owflow/docs/INDEX.md` exists:**

**If exists:**

1. Read INDEX.md to discover available documentation and standards
2. Identify which standards are relevant based on:
   - The categories and files listed in INDEX.md
   - The area of the bug (e.g., API, frontend, database)
   - Keywords in the bug description
3. **READ the applicable standard files** (see Standards Reading Enforcement below)
4. **Update `orchestrator-state.yml`**: add the paths of standards read to `project_context.standards_applied` (extra state field keyed into `project_context`; create it if absent)

**If not exists:**

- Note that no standards are available
- Suggest running `/owflow:flow-init` in the completion message

### Standards Reading Enforcement (MANDATORY)

**BLOCKING**: Reading INDEX.md alone is NOT sufficient. You MUST read actual standard files.

**Enforcement Process**:

1. Read INDEX.md to discover available standards
2. Identify which standards apply based on the bug area
3. **READ each applicable standard file** using the Read tool (not just note it exists)
4. Apply standards during fix implementation
5. List applied standards in the completion summary

**Examples of standard discovery**:

- Bug in API handler → Read API and error-handling standards
- Bug in form validation → Read validation and frontend standards
- Bug in database query → Read database and backend standards

### Step 3: Analyze & Assess Complexity

**Explore the codebase to understand the bug:**

1. Search for relevant files (Glob, Grep, Read)
2. Trace the code path where the bug occurs
3. Identify: likely root cause, affected files, existing tests
4. Form a root cause hypothesis

In **consecutive-run mode**, also read the existing phase summaries and affected files from `orchestrator-state.yml` — the newly emerging bug may interact with prior changes.

**Complexity Escalation Check:**

Assess whether this bug exceeds quick-fix scope. If **2 or more** of these signals are detected, suggest escalation:

| Signal                                                      | Example                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Changes span 5+ files across multiple modules               | Bug in shared utility affects API, frontend, and background jobs |
| Requires database schema or data model changes              | Missing column, wrong relationship, migration needed             |
| Multiple valid fix approaches with architectural trade-offs | Could fix at API layer, middleware layer, or client layer        |
| Security-sensitive code                                     | Auth, crypto, permissions, input sanitization                    |
| Root cause unclear after initial analysis                   | Symptoms don't point to a single location                        |

**If escalation triggered:**

**Write `analysis/findings.md`** in the task directory with the analysis captured so far:

```markdown
# Bug Analysis

## Root Cause

[Root cause hypothesis with evidence — file paths, code references]

## Affected Files

- `path/to/file` — reason

## Complexity Assessment

- [ ] Changes span 5+ files across multiple modules
- [ ] Requires database schema changes
- [ ] Multiple valid fix approaches with architectural trade-offs
- [ ] Security-sensitive code
- [ ] Root cause unclear after initial analysis

Signals detected: X of 5

## Test Strategy

[How the bug will be reproduced with a failing test]

## Standards Referenced

- [standard file]: [key guideline applied]
```

Use question:

- Question: "This bug appears more complex than a quick fix — [describe why]. How would you like to proceed?"
- Options:
  1. "Continue with quick fix" — proceed, accepting the complexity
  2. "Switch to full development workflow" — escalate (see below)

**If user chooses to escalate:**

1. Ensure `analysis/findings.md` is written (above)
2. Update `orchestrator-state.yml`: set `task.status: escalated`, append `escalation_reason` to `task_context.gaps` as `"[signals detected]"`, bump `orchestrator.updated`
3. Tell the user: "Run `/owflow:development .owflow/tasks/development/YYYY-MM-DD-task-name` to continue with the full workflow." The dispatcher resumes the slugs that exist and routes to the first missing one (analysis specification / planning — whatever the quick slice condensed).
4. Do NOT set `escalated_to` — the development orchestrator will set it
5. `summary.md` is NOT written on escalation
6. Then STOP

**If no escalation needed or user chooses to continue:**

Write `analysis/findings.md` (same template above — captures analysis for auditability), extract a 1–2 sentence root-cause summary into `phase_summaries.quick_analysis` (`summary`, `affected_files`, `root_cause`), then proceed to Step 4.

### Step 4: Enter Planning Mode

**Present the fix plan for user approval.**

Standards context from Step 2 and analysis from Step 3 MUST inform the plan.

**Plan file** — write `implementation/fix-plan.md`:

```markdown
## Bug Analysis

**Root Cause**: [hypothesis with evidence — file paths, code references]
**Affected Files**: [list of files that need changes]

## Proposed Fix

[Description of the fix approach — what changes, why this approach]

## Test Strategy

[What the failing test will assert — setup conditions, expected behavior]

## Applicable Standards

[List each standard file read, with key guidelines extracted from each.
If no standards exist: "No AI SDLC standards found. Consider running `/owflow:flow-init`."]

## Standards Compliance Checklist

- [ ] [Guideline from standard file] (from `standards/[path]`)
- [ ] [Guideline from standard file] (from `standards/[path]`)
```

### User approval gate: Mandatory Sections

**BLOCKING: Do NOT ask for user approval until the plan file contains:**

1. **"## Bug Analysis"** — root cause hypothesis with evidence
2. **"## Proposed Fix"** — what changes and why
3. **"## Test Strategy"** — what the TDD red test will assert
4. **"## Applicable Standards"** — standards read and key guidelines
5. **"## Standards Compliance Checklist"** — checkboxes for applicable guidelines

If any section is missing, add it before asking for user approval.

### Approval question

Use `question` — present the mini plan (root cause, approach, affected files, test strategy) and ask "Proceed with the fix?" Options:

- **Approve and implement** — continue with the TDD red gate
- **Adjust** — rework the plan (different approach, different files), re-ask
- **Run full pipeline instead** — escalate per the escalation procedure in Step 3 (escalation handling), then STOP
- **Cancel** — end; state and artifacts persist

On approval: append the condensed-phase slugs `codebase-analysed` and `gap-analysed` to `completed_phases` (the condensed analysis in Steps 2–3 covers both; note the condensation in `phase_summaries.codebase_analysis` / `phase_summaries.gap_analysis`), bump `orchestrator.updated`, and re-run `verify_template` on the state file. In **consecutive-run mode** these slugs already exist — do not append duplicates; instead note the re-fix in the existing analysis artifacts.

### Step 5: TDD Red Gate (`tdd-red-proven`)

**Write a failing test that reproduces the bug.**

Direct execution (targeted, single-test task — no delegation).

1. Identify the appropriate test file (existing test suite or create new test file following project conventions)
2. Write a test that:
   - Sets up the conditions that trigger the bug
   - Asserts the **correct** (expected) behavior
   - Should FAIL with current code (proving the bug exists)
3. Run the test

**The test MUST fail.** This proves the bug is real and reproducible.

**If the test passes:**

- The bug may not be what we think, or it's already fixed
- Investigate further — re-read the bug description, check if conditions are correct
- Use question: "The reproduction test passes — the expected behavior already works under these conditions. Is the bug description accurate, or are there additional conditions?"

**On success**: record the test path and key failure output in `implementation/tdd-red-gate.md` (mimicking the dev-tdd-red artifact), append `tdd-red-proven` to `completed_phases`, set `task_context.tdd_red_passed: true` (create `task_context` fields if absent), bump `orchestrator.updated`, re-run `verify_template`.

**On failure to reproduce** (test framework issues, 2 rewrite attempts exhausted): do NOT append `tdd-red-proven`; document the blocker in `task_context.gaps` and use `question`: "The bug could not be reproduced with a failing test. Continue without a red gate (documented skip), or stop?" A user-chosen skip is recorded in `task_context.gaps` with `task_context.tdd_red_passed: false` — no slugs appended. If the user chooses stop → STOP (state persists; resumable via `/owflow:dev-bugfix <task-path>`).

### Step 6: Fix & Verify — TDD Green Gate (`implementation-done`, `tdd-green-proven`)

**Implement the fix:**

1. Apply the fix based on the approved plan from Step 4
2. **Apply discovered standards** from Step 2
3. Run the failing test — it MUST now pass
4. Run the full test file and related test files to check for regressions
5. Append progress to `implementation/work-log.md` (what was fixed, files touched, test results — creating the file if absent); in **consecutive-run mode** append to the existing work-log rather than overwriting.

**If tests fail after fix:**

- Analyze the failure
- Adjust the fix
- Re-run tests
- Maximum 3 fix-and-verify iterations

**If still failing after 3 attempts:**

- Stop and present findings to the user
- Suggest escalating to `/owflow:development <task-path>` for a more thorough approach (the task is a standard dev task — the dispatcher continues it)

**On success**: append `implementation-done` and `tdd-green-proven` to `completed_phases`, set `task_context.tdd_green_passed: true`, record test results in `implementation/tdd-green-gate.md`, extract 1–2 sentences into `phase_summaries.implementation` (root cause in 1 line, fix, files changed, test results), bump `orchestrator.updated`, re-run `verify_template`.

### Downstream reset (consecutive-run mode only)

If `completed_phases` contained any of `options-chosen`, `verification-done`, `e2e-run`, `docs-generated`, `task-completed` **before** this run, REMOVE those downstream slugs now — new code invalidates prior verification, so the pipeline must route back to `/owflow:dev-verify`. Also set `verification_context.last_status: null` (re-verification required). Do NOT remove the fix slugs appended this run.

### Step 7: Summary

**Write `summary.md`** in the task directory (in consecutive-run mode, write `summary.md` describing THIS fix run; earlier runs' summaries are reflected in the work-log):

```markdown
# Task Summary

**Command**: dev-bugfix
**Date**: YYYY-MM-DD
**Status**: completed

## What Was Done

[Root cause and fix description]

## Files Modified

- `path/to/file`

## Standards Applied

- [standard]: [guideline]

## Tests

- [test file] — [result]

## Commit Suggestion

[conventional commit message]
```

**Update `orchestrator-state.yml`**: set `task.status: completed` (both modes — in consecutive-run mode, the task stays open for verification, so use `task.status: in_progress` instead when the downstream reset applied), `updated: [now]`, plus final state update convention below.

**Post-implementation: verify standards compliance using the checklist from the plan file.**

### State Update Convention (per step)

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the slugs actually performed plus that step's fields. Never batch multiple steps into one end-of-skill write. (Slugs are appended at the step boundaries flagged above: approval → analysis slugs, Step 5 → `tdd-red-proven`, Step 6 → `implementation-done` + `tdd-green-proven`.)
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if a step ultimately fails (retries exhausted, user stops): do NOT append its slugs; document the blocker in `task_context.gaps`; in consecutive-run mode the task's existing slugs are untouched.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

### Step 8: Exit Gate

Present results, get user confirmation, then close (Exit Gate contract, `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

**Results box**:

```markdown
## ✅ QUICK BUGFIX COMPLETE — <task name>

**Root cause** — [1-line root cause]
**Fix** — [1-line fix description]
**Files** — [count + key files]
**Tests** — [red gate failed → green gate passed]
**Standards** — [applied standards count]
**Entry point** — [standalone bootstrap / consecutive fix on existing task]
**Task state** — [slugs appended this run / pipeline position]

**Artifacts**
- implemented code
- `summary.md`
- `analysis/findings.md`
- `implementation/fix-plan.md`
- `implementation/tdd-red-gate.md` + `implementation/tdd-green-gate.md`
- `implementation/work-log.md`
- `orchestrator-state.yml` (status: <completed | in_progress>)
```

**Results-acceptance question** — use `question` — "Is the bug fixed correctly?" with options:

- **Accept** — fix verified; print next steps below.
- **Adjust** — re-work the fix (different approach, additional files), re-run the TDD loop, then re-present the results box.
- **Discuss** — walk through root cause analysis and fix reasoning in more depth; then re-ask.
- **Stop here** — end; `summary.md` and the task directory persist. Resume or escalate later via the hints below.

**Next steps (after Accept)**:

Standalone (fresh task):

```
✓ Bug fixed — <task-path>

Next steps:
  → /owflow:dev-verify <task-path>   — recommended: run the verification pipeline
                                       (completeness, code review) before commit

Other options:
  → Commit using the suggested message from summary.md
  /owflow:goal-development <task-path>   — run verify → finalize in one loop
  /owflow:dev-spec <task-path>           — write a formal specification later if needed
```

Consecutive run (existing task, downstream slugs were reset):

```
✓ Bug fixed on <task-path>

Next steps:
  → /owflow:dev-verify <task-path>   — required: re-verification after new code
```

Other options:

```
  /owflow:development <task-path>          — full workflow view of the task
  /owflow:dev-bugfix <task-path>         — fix another emerging problem on this task
  /owflow:reviews-code <task-path>         — deeper review of the fix
```

Then STOP.

---

## What This Does

1. **Resolves** the argument: bug description → fresh task bootstrap; task path/identifier → consecutive fix on an existing development task
2. **Creates/bootstraps** a standard development task directory with `orchestrator-state.yml` (dev template, `entry_point: dev-bugfix`)
3. **Discovers** applicable standards from `.owflow/docs/INDEX.md` and records them in state
4. **Analyzes** codebase to find root cause, writes `analysis/findings.md`, and assesses complexity
5. **Escalates** to the full development workflow if the bug is too complex (sets `task.status: escalated`)
6. **Plans** the fix (`implementation/fix-plan.md`) and presents it for user approval
7. **Reproduces** the bug with a failing test (TDD red, `tdd-red-proven`)
8. **Fixes** the bug and verifies the test passes (TDD green, `implementation-done` + `tdd-green-proven`); on consecutive runs, resets downstream verification slugs
9. **Summarizes** in `summary.md` and keeps the task continuable by any dev-* subskill

## Graceful Fallback

**If `.owflow/docs/` does not exist:**

Proceed with the bug fix normally, then note:

```
"No AI SDLC standards found. Consider running `/owflow:flow-init` to initialize
project documentation and coding standards for better consistency."
```
