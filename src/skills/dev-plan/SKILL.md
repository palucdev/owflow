---
name: dev-plan
description: Development — break the approved specification into a grouped, dependency-ordered implementation plan.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Plan — Phase 6 (Implementation Planning)

Work phase of the development workflow. Delegates planning to break the specification into task groups with dependencies, then refines the plan with an execution diagram.

## Task Resolution

Resolve the `task-path-or-identifier` argument BEFORE anything else:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the selection block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Phases 1–2 (codebase & gap analysis) → `/owflow:dev-analyze <task-path>`
     - Phase 3 (TDD red gate) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Phases 4–5 (requirements, specification & audit) → `/owflow:dev-spec <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

## Entry Check

1. Apply **Task Resolution** above to obtain the task path.
2. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
3. **Skip check**: if `phase-6` is in `completed_phases`, report the existing plan summary and suggest next command.
4. **Prerequisite**: `implementation/spec.md` exists (spec approved in Phase 4). If missing → print the blocked block, then STOP:
   - Steps that must be completed first: Phases 1–2 (analysis) → Phase 3 (TDD red gate, only when a reproducible defect was detected) → Phases 4–5 (specification).
   - `Run /owflow:dev-spec <task-path> first` (or `/owflow:dev-analyze <task-path>` if analysis is also missing).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

**ANTI-PATTERN — never write implementation-plan.md yourself. "This is simple enough to plan inline" is NOT a reason to skip delegation.**

1. Task tool - `implementation-planner`. Pass: task_path, task_description, task_characteristics, `phase_summaries` (specification, gap_analysis, codebase_analysis), research/quick context if present in state. Output: `implementation/implementation-plan.md`.
2. **Post-plan diagram refinement** (Skill, content-preserving): Skill tool - `diagrams-mermaid` on `implementation/implementation-plan.md`. Add a compact execution diagram (task-group dependency flow or phase/state view). Implementation steps remain authoritative; diagrams are explanatory.

## State Update Convention (per step)

1. **On success** (implementation-plan.md written and diagram refined): immediately append `phase-6` to `completed_phases`; write 1-2 sentence summary to `phase_summaries.planning`; bump `orchestrator.updated`.
2. **On failure** (planner fails, plan incomplete, or diagram refinement could not recover): do NOT append to `completed_phases`; append `phase-6` to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-6"]`.
3. **Timestamp + validate** — set `orchestrator.updated` on every write; after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately.
4. **Final check** — before the Closing Ritual, one consolidated re-read + `verify_template` run.

## Closing Ritual

**Results** — executive summary from `implementation/implementation-plan.md`: number of task groups, total steps, key dependencies, estimated complexity. Artifact written: `implementation/implementation-plan.md`.

**Next steps**:

- `→ /owflow:dev-implement <task-path>`

**Other options**:

- `/owflow:goal-development <task-path>` — continue remaining phases in one loop

Then STOP.
