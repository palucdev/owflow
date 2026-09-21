---
name: owflow:dev-implement
description: Development — execute the implementation plan via delegation, then the TDD Green Gate when a red gate exists.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Implement — Implementation & TDD Green Gate (implementation-done, tdd-green-proven)

Work phase of the development workflow. Executes the implementation plan via delegation, then verifies the TDD red-gate test now passes when one exists.

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
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                              | Produced by                      |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`        | `/owflow:development <desc>`     |
| Spec approved           | `implementation/spec.md` exists             | `/owflow:dev-spec <task-path>`   |
| Plan approved           | `implementation/implementation-plan.md` exists | `/owflow:dev-plan <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `implementation-done` is in `completed_phases`, skip to the TDD green gate.
3. **Prerequisite check**: `implementation/spec.md` AND `implementation/implementation-plan.md` exist. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: analysis (`codebase-analysed`, `gap-analysed`) → TDD red gate (`tdd-red-proven`, only when a reproducible defect was detected) → specification (`spec-written`) → implementation planning (`plan-created`).
   - `Run /owflow:dev-spec and /owflow:dev-plan <task-path> first` (or `/owflow:dev-analyze <task-path>` / `/owflow:dev-spec <task-path>` for the missing earlier steps).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Implementation (`implementation-done`) — Skill tool

**ANTI-PATTERN — never implement directly. "Simple enough to code inline" is NOT a reason to skip delegation.**

Skill tool - `implementation-plan-executor`. Pass: task_path, task_description, task_characteristics, `phase_summaries`, research/quick context if present in state. The skill manages its own subagents, incremental tests, and `implementation/work-log.md`.

### TDD Green Gate (`tdd-green-proven`, conditional)

**Skip if** `tdd-red-proven` is NOT in `completed_phases` (no red gate exists).

1. Run the test written in the red gate (path recorded in `implementation/tdd-red-gate.md`).
2. **It MUST pass** — proves the defect is fixed. On failure: fix implementation and retry (up to 5 attempts: syntax, imports, test alignment). Still failing → `question`: continue fixing, return to `/owflow:dev-implement` implementation work, or stop.
3. Write results to `implementation/tdd-green-gate.md`; set `task_context.tdd_green_passed: true`.

## State Update Convention (per step)

Apply after EVERY phase/step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed plus that step's fields. Never batch multiple steps into one end-of-skill write:
   - After implementation (plan execution complete): append `implementation-done` to `completed_phases`; extract 1-2 sentence summary to `phase_summaries.implementation` (task groups completed, files changed, test results, known issues); bump `orchestrator.updated`.
   - After the green gate (only when it ran — no red gate ⇒ no `tdd-green-proven`): append `tdd-green-proven` to `completed_phases`; set `task_context.tdd_green_passed: true`; bump `orchestrator.updated`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the implementation or green gate ultimately fails (retries exhausted, user stops): do NOT append the corresponding slug to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`. Partial progress stays documented in `phase_summaries.implementation` and `implementation/work-log.md`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then hand off (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ DEV IMPLEMENT COMPLETE — <task name>

**Task groups** — [completed groups / total]
**Files changed** — [count + key files, 1-3 lines]
**Tests** — [incremental test results]
**Green gate** — [✅ PASSED / not required (no red gate)]
**Known issues** — [deferred items / "none"]

**Artifacts**
- implemented code
- `implementation/work-log.md`
- `implementation/tdd-green-gate.md` [conditional]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — implementation matches the plan; continue.
- **Adjust** — re-work the affected task groups (fix code, re-run their tests), update state and work-log, re-present the results box.
- **Discuss** — walk through implementation details (decisions made, files changed, deferred items) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-implement <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:dev-verify <task-path>` — `required` before commit: runs the verification pipeline (completeness, code review with a bounded fix loop) and must pass before finalization. Remaining after: finalize.

**Other options**:

- `/owflow:goal-development <task-path>` — `optional` shortcut: runs all remaining phases in one loop (verify → finalize)

Then STOP.
