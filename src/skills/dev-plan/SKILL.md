---
name: owflow:dev-plan
description: Development — break the approved specification into a grouped, dependency-ordered implementation plan.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Plan — Implementation Planning (plan-created)

Work phase of the development workflow. Delegates planning to break the specification into task groups with dependencies, then refines the plan with an execution diagram.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Codebase & gap analysis (`codebase-analysed`, `gap-analysed`) → `/owflow:dev-analyze <task-path>`
     - TDD red gate (`tdd-red-proven`) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Requirements, specification & audit (`spec-written`, `spec-audited`) → `/owflow:dev-spec <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                       | Produced by                      |
| ----------------------- | ---------------------------------------------------- | -------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                 | `/owflow:development <desc>`     |
| Spec approved           | `implementation/spec.md` exists                      | `/owflow:dev-spec <task-path>`   |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `plan-created` is in `completed_phases`, report the existing plan summary and route to the Exit Gate.
3. **Prerequisite check**: `implementation/spec.md` exists (spec approved during `spec-written`). If missing → print the blocked block, then STOP:
   - Steps that must be completed first: analysis (`codebase-analysed`, `gap-analysed`) → TDD red gate (`tdd-red-proven`, only when a reproducible defect was detected) → specification (`spec-written`).
   - `Run /owflow:dev-spec <task-path> first` (or `/owflow:dev-analyze <task-path>` if analysis is also missing).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

**ANTI-PATTERN — never write implementation-plan.md yourself. "This is simple enough to plan inline" is NOT a reason to skip delegation.**

1. Task tool - `implementation-planner`. Pass: task_path, task_description, task_characteristics, `phase_summaries` (specification, gap_analysis, codebase_analysis), research/quick context if present in state. Output: `implementation/implementation-plan.md`.
2. **Post-plan diagram refinement** (Skill, content-preserving): Skill tool - `diagrams-mermaid` on `implementation/implementation-plan.md`. Add a compact execution diagram (task-group dependency flow or phase/state view). Implementation steps remain authoritative; diagrams are explanatory.

## State Update Convention (per step)

1. **On success** (implementation-plan.md written and diagram refined): immediately append `plan-created` to `completed_phases`; write 1-2 sentence summary to `phase_summaries.planning`; bump `orchestrator.updated`.
2. **On failure** (planner fails, plan incomplete, or diagram refinement could not recover): do NOT append to `completed_phases`; append `plan-created` to `orchestrator.failed_phases` and increment `auto_fix_attempts["plan-created"]`.
3. **Timestamp + validate** — set `orchestrator.updated` on every write; after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately.
4. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run.

## Exit Gate

Present results, get user confirmation, then hand off (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ DEV PLAN COMPLETE — <task name>

**Task groups** — [N]
**Total steps** — [M]
**Dependencies** — [key ordering constraints, 1-2 lines]
**Complexity** — [estimated complexity]

**Artifacts**
- `implementation/implementation-plan.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the plan is good; continue.
- **Adjust** — regenerate the plan with the user's corrections (grouping, ordering, scope), update state, re-present the results box.
- **Discuss** — walk through the plan structure (task groups, dependencies, step breakdown) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-plan <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:dev-implement <task-path>` — `required` next: executes the plan task group by task group via subagents (includes the TDD green gate when a red gate exists). Remaining after: verify → finalize.

**Other options**:

- `/owflow:goal-development <task-path>` — `optional` shortcut: runs all remaining phases in one loop (implement → verify → finalize)

Then STOP.
