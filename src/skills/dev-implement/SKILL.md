---
name: owflow:dev-implement
description: Development — execute the implementation plan via delegation, then the TDD Green Gate when a red gate exists. --quick starts a condensed task here when no state file exists.
argument-hint: "[task-path-or-identifier | \"description\"] [--quick]"
user-invocable: true
---

# Dev Implement — Implementation & TDD Green Gate (implementation-done, tdd-green-proven)

Work phase of the development workflow. Executes the implementation plan via delegation, then verifies the TDD red-gate test now passes when one exists.

Supports a **quick mode** (`--quick`, or any description argument with no existing task): a condensed prelude that bootstraps a standard development task (state file, condensed spec + plan) and then continues into the normal implementation below. After the Exit Gate, the pipeline can either stop there or continue with `/owflow:dev-verify` — the task is a regular development task, resumable by any dev-* subskill.

## Entry Gate

Resolve the argument BEFORE anything else (see `orchestrator-patterns.md` Section 9). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- **Description** — anything else (quoted free text, e.g. `"Add a logout button to the navbar"`) is treated as a new task description for quick bootstrap.

Route by argument kind and flags:

| Situation                                                        | Route                                        |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Task path/identifier, state + spec + plan exist (or only implementation pending) | Normal implementation below |
| Task path/identifier, `--quick`, spec or plan missing            | Quick prelude for the missing pieces, then normal implementation |
| Description argument, `--quick` (or no argument after prompt)    | Quick bootstrap (create task + condensed prelude), then normal implementation |
| Description argument, no `--quick`                               | Ask via `question`: quick condensed task / full pipeline (blocked block below) / cancel |
| Missing argument                                                 | Prompt for input (path, identifier, or description), then re-route |

If the path does **not exist** or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - Codebase & gap analysis (`codebase-analysed`, `gap-analysed`) → `/owflow:dev-analyze <task-path>`
   - TDD red gate (`tdd-red-proven`) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
   - Requirements, specification & audit (`spec-written`, `spec-audited`) → `/owflow:dev-spec <task-path>`
   - Implementation planning (`plan-created`) → `/owflow:dev-plan <task-path>`
2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
3. Hint: `Run /owflow:development <description> to start a task from scratch, /owflow:dev-implement --quick "<description>" for a condensed quick task, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                              | Produced by                      |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`        | `/owflow:development <desc>` or quick bootstrap |
| Spec approved           | `implementation/spec.md` exists             | `/owflow:dev-spec <task-path>` or quick prelude |
| Plan approved           | `implementation/implementation-plan.md` exists | `/owflow:dev-plan <task-path>` or quick prelude |

1. **Read `orchestrator-state.yml`** from the task path. If missing → quick bootstrap (see Quick Mode) or print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `implementation-done` is in `completed_phases`, skip to the TDD green gate.
3. **Prerequisite check**: `implementation/spec.md` AND `implementation/implementation-plan.md` exist. If missing → run the Quick prelude for the missing pieces (`--quick` or user chooses quick), otherwise print the blocked block, then STOP:
   - Steps that must be completed first: analysis (`codebase-analysed`, `gap-analysed`) → TDD red gate (`tdd-red-proven`, only when a reproducible defect was detected) → specification (`spec-written`) → implementation planning (`plan-created`).
   - `Run /owflow:dev-spec and /owflow:dev-plan <task-path> first` (or `/owflow:dev-analyze <task-path>` / `/owflow:dev-spec <task-path>` for the missing earlier steps).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch, or /owflow:dev-implement --quick "<description>" for a condensed quick task.`

## Quick Mode (condensed prelude → normal implementation)

Quick mode produces the same artifacts as the early pipeline phases — just condensed into one pass inside this skill. It does NOT introduce a second state format: the task gets a standard `orchestrator-state.yml` and standard artifacts, so every other dev-* subskill can pick it up afterwards.

### Quick bootstrap (no state file, description argument)

1. **Create Task Directory**: `.owflow/tasks/development/YYYY-MM-DD-task-name/` (3–5 kebab-case words from the description).
2. **Initialize State**: create `orchestrator-state.yml` from the development template with `task.title` / `task.description` from the description, `task.status: in_progress`, `orchestrator.entry_point: "dev-implement --quick"`, and `task_context.task_characteristics.has_reproducible_defect` set to `true` ONLY when the description is clearly bug-shaped (symptom + expected vs actual); otherwise `false`. Bug-shaped descriptions with a reproducible defect → suggest `/owflow:quick-bugfix` instead (TDD red gate discipline), unless the user insists on proceeding here.
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-development.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists) and extract the Project Documentation file paths into `project_context.project_doc_paths` (matching the development dispatcher's initialization).
4. If `.owflow/docs/` does not exist, proceed without standards and note the graceful-fallback hint in the completion message: `"No AI SDLC standards found. Consider running /owflow:flow-init to initialize project documentation and coding standards."`

### Quick prelude (one condensed pass)

**MANDATORY order — standards before analysis, analysis before spec/plan:**

1. **Standards discovery**: identify applicable standards from INDEX.md by task keywords (e.g., "API" → api/error-handling, "form" → validation/accessibility) and **READ each applicable standard file** with the Read tool — reading INDEX.md alone is NOT sufficient. Record the paths in `project_context.standards_applied` (extra state field) and reference them in the spec.
2. **Brief codebase analysis**: explore the affected areas (Glob, Grep, Read) — enough to identify affected files/modules, existing patterns, and test strategy. Write `analysis/quick-analysis.md` (affected files, approach sketch, standards referenced). Extract a 1–2 sentence summary into `phase_summaries.quick_analysis`.
3. **Condensed spec**: write `implementation/spec.md` — goal, scope (in/out), requirements, applicable standards with key guidelines, verification criteria. Mark `spec-written` complete (`phase_summaries.specification` summary).
4. **Condensed plan**: write `implementation/implementation-plan.md` — 1–3 task groups, each with concrete checkable steps and tests. Use the same on-the-fly plan shape as the dev-plan quick prelude: key discoveries with `file:line` references, a "What We're NOT Doing" out-of-scope list, intent + contract per step (no code snippets unless non-obvious), automated vs manual acceptance criteria, and no open questions (resolve before finalizing). Mark `plan-created` complete.
5. **Approval gate** — use `question`: present the mini plan (goal, approach, affected files, task groups) and ask "Proceed with implementation?" Options: **Approve and implement** / **Adjust** (rework spec/plan, re-ask) / **Run full pipeline instead** (print `/owflow:development <task-path>` and STOP — do not implement) / **Cancel**.
6. On approval: append `codebase-analysed` and `gap-analysed` to `completed_phases` (quick analysis covers both; note the condensation in `phase_summaries.codebase_analysis` / `phase_summaries.gap_analysis`), bump `orchestrator.updated`, re-run `verify_template` on the state file.

The TDD red gate is SKIPPED in quick mode (no `tdd-red-proven`), and the green gate below is therefore skipped too. `spec-audited` is skipped — the approval gate in step 5 substitutes for the audit.

Then continue with **Execute** below as a normal run.

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
**Entry point** — [quick bootstrap (`--quick`) / full pipeline]

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
- **Stop here** — print the resume command (`/owflow:dev-implement <task-path>`) and end. The task is a regular development task; `/owflow:dev-verify <task-path>` (or `/owflow:development <task-path>`) continues the pipeline later.

### Next steps (after Accept)

- `→ /owflow:dev-verify <task-path>` — `required` before commit: runs the verification pipeline (completeness, code review with a bounded fix loop) and must pass before finalization. Remaining after: finalize.

**Other options**:

- `/owflow:goal-development <task-path>` — `optional` shortcut: runs all remaining phases in one loop (verify → finalize)

Then STOP.
