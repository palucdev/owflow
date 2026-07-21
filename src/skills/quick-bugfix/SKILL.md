---
name: quick-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation
argument-hint: "[bug description]"
user-invocable: true
---

# Quick Bug Fix

Lightweight TDD-driven bug fix workflow with planning mode. Analyze the bug, present a fix plan for approval, then reproduce with a failing test, fix, and verify. No orchestrator state, no subagents. Creates lightweight task directory for artifact anchoring.

For complex bugs that grow beyond a quick fix, suggests escalating to the full development workflow (`/development`).

## Usage

```bash
/quick-bugfix "Login form submits twice on slow connections"
/quick-bugfix "API returns 500 when email contains special characters"
/quick-bugfix "Dark mode toggle doesn't persist after refresh"
```

## When to Use

**Use `/quick-bugfix` when:**

- Bug is reasonably scoped and reproducible
- You have a clear description of expected vs actual behavior
- Fix likely touches a small number of files

**Use `/development` instead when:**

- Bug requires architectural changes
- Multiple subsystems are involved
- You need formal specification and planning

---

## Workflow

### Step 1: Parse Input

**Get the bug description:**

- If provided as argument, use it directly
- If not provided, scan the recent conversation for bug context (error messages, reproduction steps, discussed symptoms). If found, use that as the bug description.
- Only if no argument AND no bug context in session, use question:
  ```
  "Describe the bug — what's the expected behavior vs actual behavior?"
  ```

### Step 2: Create Task Directory

**Create a lightweight task directory for artifact anchoring.**

1. Generate a task name from the bug description:
   - Extract 3–5 key words, convert to lowercase kebab-case
   - Prepend today's date: `YYYY-MM-DD-kebab-name`
   - Examples: "Fix login timeout bug" → `2026-05-28-fix-login-timeout`, "Login form submits twice on slow connections" → `2026-05-28-login-double-submit`
2. Create directory: `.owflow/tasks/quick-bugfix/YYYY-MM-DD-task-name/`
3. Create `analysis/` subdirectory inside it
4. Write `task.yml` with initial state using the template [src/templates/quick-bugfix-task.yml](../../templates/quick-bugfix-task.yml).
5. **CRITICAL**: Use the `verify_template` tool immediately after creation to check YAML validity against `quick-bugfix-task.yml`.

### Step 3: Discover Standards

**CRITICAL: This step MUST complete before entering plan mode.**

**Check if `.owflow/docs/INDEX.md` exists:**

**If exists:**

1. Read INDEX.md to discover available documentation and standards
2. Identify which standards are relevant based on:
   - The categories and files listed in INDEX.md
   - The area of the bug (e.g., API, frontend, database)
   - Keywords in the bug description
3. **READ the applicable standard files** (see Standards Reading Enforcement below)
4. **Update `task.yml`**: Add paths of standards read to `standards_applied` list

**If not exists:**

- Note that no standards are available
- Suggest running `/flow-init` in completion message

### Standards Reading Enforcement (MANDATORY)

**BLOCKING**: Reading INDEX.md alone is NOT sufficient. You MUST read actual standard files.

**Enforcement Process**:

1. Read INDEX.md to discover available standards
2. Identify which standards apply based on the bug area
3. **READ each applicable standard file** using Read tool (not just note it exists)
4. Apply standards during fix implementation
5. List applied standards in completion summary

**Examples of standard discovery**:

- Bug in API handler → Read API and error-handling standards
- Bug in form validation → Read validation and frontend standards
- Bug in database query → Read database and backend standards

### Step 4: Analyze & Assess Complexity

**Explore the codebase to understand the bug:**

1. Search for relevant files (Glob, Grep, Read)
2. Trace the code path where the bug occurs
3. Identify: likely root cause, affected files, existing tests
4. Form a root cause hypothesis

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
2. Update `task.yml`: set `status: escalated`, `escalation_reason: "[signals detected]"`, `updated: [now]`
3. Tell the user: "Run `/development .owflow/tasks/quick-bugfix/YYYY-MM-DD-task-name` to continue with full workflow."
4. Do NOT set `escalated_to` — the development orchestrator will set it
5. `summary.md` is NOT written on escalation

**If no escalation needed or user chooses to continue:**

Write `analysis/findings.md` (same template above — captures analysis for auditability), then proceed to Step 5.

### Step 5: Enter Planning Mode

**Use the `Plan Agent` to present the fix plan for user approval.**

Standards context from Step 3 and analysis from Step 4 MUST inform the plan.

**Plan file content:**

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
If no standards exist: "No AI SDLC standards found. Consider running `/flow-init`."]

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

### Step 6: TDD Red Gate

**Write a failing test that reproduces the bug.**

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

### Step 7: Fix & Verify (TDD Green)

**Implement the fix:**

1. Apply the fix based on the approved plan from Step 5
2. **Apply discovered standards** from Step 3
3. Run the failing test — it MUST now pass
4. Run the full test file and related test files to check for regressions

**If tests fail after fix:**

- Analyze the failure
- Adjust the fix
- Re-run tests
- Maximum 3 fix-and-verify iterations

**If still failing after 3 attempts:**

- Stop and present findings to the user
- Suggest escalating to `/development` for a more thorough approach

### Step 8: Summary

**Write `summary.md`** in the task directory:

```markdown
# Task Summary

**Command**: quick-bugfix
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

**Update `task.yml`**: set `status: completed`, `updated: [now]`.

**Post-implementation: verify standards compliance using the checklist from the plan file.**

---

## What This Does

1. **Parses** bug description from user input
2. **Creates** lightweight task directory with `task.yml` for artifact anchoring
3. **Discovers** applicable standards from `.owflow/docs/INDEX.md`
4. **Analyzes** codebase to find root cause, writes `analysis/findings.md`, and assesses complexity
5. **Escalates** to full development workflow if bug is too complex (updates `task.yml` status to `escalated`)
6. **Plans** the fix and presents for user approval via planning mode
7. **Reproduces** bug with a failing test (TDD Red)
8. **Fixes** the bug and verifies test passes (TDD Green)
9. **Summarizes** in `summary.md`, updates `task.yml` status to `completed`

## Graceful Fallback

**If `.owflow/docs/` does not exist:**

Proceed with the bug fix normally, then note:

```
"No AI SDLC standards found. Consider running `/flow-init` to initialize
project documentation and coding standards for better consistency."
```
