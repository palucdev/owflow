---
name: dev-tdd-red
description: Development — TDD Red Gate. Write a failing test that reproduces the defect before any implementation work.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev TDD Red — Phase 3 (TDD Red Gate)

Work phase of the development workflow. Writes a failing test proving the defect exists, before any implementation. Only runs when the gap analysis detected a reproducible defect.

## Task Resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the selection block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Phases 1–2 (codebase & gap analysis) → `/owflow:dev-analyze <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

## Entry Check

1. Apply **Task Resolution** above to obtain the task path.
2. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
3. **Skip check**: if `phase-3` is in `completed_phases`, report the existing `implementation/tdd-red-gate.md` results and suggest the next command.
4. **Activation check**: read `task_context.task_characteristics.has_reproducible_defect`. If `false` → print `No reproducible defect detected — TDD red gate not required.` and suggest `→ /owflow:dev-spec <task-path>`, then STOP.
5. **Prerequisite**: `phase-2` must be in `completed_phases`. If not → print the blocked block, then STOP:
   - Steps that must be completed first: Phases 1–2 (codebase & gap analysis).
   - Run `/owflow:dev-analyze <task-path> first.`
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

Direct execution (no delegation — this is a targeted, single-test task):

1. Read `analysis/clarifications.md`, `analysis/gap-analysis.md`, and the affected files identified by the analysis to understand the defect.
2. Write ONE focused test that reproduces the defect (correct test framework for the project — check existing test setup).
3. Run the test. **It MUST fail** — a failing result proves the defect exists. If it passes unexpectedly, the defect is not reproduced: revise the test or report the mismatch via `question`.

**Critical**: Do NOT fix anything. Do NOT write implementation code. The test failing is the deliverable.

## State Update Convention (per step)

1. **On success** (test fails as expected, red gate proven): immediately append `phase-3` to `completed_phases` and set `task_context.tdd_red_passed: true`; bump `orchestrator.updated`.
2. **On failure or abandoned retries** (test framework issues, imports that could not be resolved): do NOT append to `completed_phases`; append `phase-3` to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-3"]`; document the blocker in `task_context.gaps`.
3. **On user-chosen skip** (via `question` after repeated failures): record the skip with the failure reason in `task_context.gaps` and set `task_context.tdd_red_passed: false` — no `completed_phases` entry, no `failed_phases` entry (it was a deliberate decision, not a failure).
4. **Timestamp + validate** — set `orchestrator.updated` on every write; after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately.
5. **Final check** — before the Closing Ritual, one consolidated re-read + `verify_template` run.

Retry rule: on repeated failures (test framework issues, imports) retry up to 2 times (rewrite test, fix setup). Still failing → `question`: continue trying, or skip TDD with the failure documented in state (per rule 3).

## Closing Ritual

**Results** — display: test file path, test name, the exact failure output proving the defect, artifact written: `implementation/tdd-red-gate.md`.

**Next steps**:

- `→ /owflow:dev-spec <task-path>` — the spec will incorporate this test as the acceptance criterion for the fix

**Other options**:

- `/owflow:goal-development <task-path>` — continue remaining phases in one loop

Then STOP.
