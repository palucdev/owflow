---
name: dev-implement
description: Development — execute the implementation plan via delegation, then the TDD Green Gate when a red gate exists.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Implement — Phases 7–8 (Implementation & TDD Green Gate)

Work phase of the development workflow. Executes the implementation plan via delegation, then verifies the TDD red-gate test now passes when one exists.

## Task Resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the selection block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Phases 1–2 (codebase & gap analysis) → `/owflow:dev-analyze <task-path>`
     - Phase 3 (TDD red gate) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Phases 4–5 (requirements, specification & audit) → `/owflow:dev-spec <task-path>`
     - Phase 6 (implementation planning) → `/owflow:dev-plan <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

## Entry Check

1. Apply **Task Resolution** above to obtain the task path.
2. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
3. **Skip check**: if `phase-7` is in `completed_phases`, skip to the Phase 8 green gate.
4. **Prerequisite**: `implementation/spec.md` AND `implementation/implementation-plan.md` exist. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: Phases 1–2 (analysis) → Phase 3 (TDD red gate, only when a reproducible defect was detected) → Phases 4–5 (specification) → Phase 6 (implementation planning).
   - `Run /owflow:dev-spec and /owflow:dev-plan <task-path> first` (or `/owflow:dev-analyze <task-path>` / `/owflow:dev-spec <task-path>` for the missing earlier steps).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Phase 7 — Implementation (Skill)

**ANTI-PATTERN — never implement directly. "Simple enough to code inline" is NOT a reason to skip delegation.**

Skill tool - `implementation-plan-executor`. Pass: task_path, task_description, task_characteristics, `phase_summaries`, research/quick context if present in state. The skill manages its own subagents, incremental tests, and `implementation/work-log.md`.

### Phase 8 — TDD Green Gate (conditional)

**Skip if** `phase-3` is NOT in `completed_phases` (no red gate exists).

1. Run the test written in the red gate (path recorded in `implementation/tdd-red-gate.md`).
2. **It MUST pass** — proves the defect is fixed. On failure: fix implementation and retry (up to 5 attempts: syntax, imports, test alignment). Still failing → `question`: continue fixing, return to `/owflow:dev-implement` implementation work, or stop.
3. Write results to `implementation/tdd-green-gate.md`; set `task_context.tdd_green_passed: true`.

## State Update Convention (per step)

Apply after EVERY phase/step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the `phase-N` entry actually performed plus that step's fields. Never batch multiple phases into one end-of-skill write:
   - After Phase 7 (plan execution complete): append `phase-7` to `completed_phases`; extract 1-2 sentence summary to `phase_summaries.implementation` (task groups completed, files changed, test results, known issues); bump `orchestrator.updated`.
   - After Phase 8 (only when the green gate ran — no red gate ⇒ no `phase-8`): append `phase-8` to `completed_phases`; set `task_context.tdd_green_passed: true`; bump `orchestrator.updated`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the implementation or green gate ultimately fails (retries exhausted, user stops): do NOT append the corresponding `phase-N` to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-N"]`. Partial progress stays documented in `phase_summaries.implementation` and `implementation/work-log.md`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Closing Ritual, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Closing Ritual

**Results** — executive summary from `phase_summaries.implementation` and `implementation/work-log.md`: task groups completed, files changed, incremental test results, deferred items. Artifacts written: implemented code, `implementation/work-log.md`, `implementation/tdd-green-gate.md` (conditional).

**Next steps**:

- `→ /owflow:dev-verify <task-path>`

**Other options**:

- `/owflow:goal-development <task-path>` — continue remaining phases in one loop

Then STOP.
