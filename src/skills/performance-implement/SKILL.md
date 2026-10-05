---
name: owflow:performance-implement
description: Performance — executes the approved implementation plan via the implementation-plan-executor skill, then records implementation-done. Continues with performance-verify.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Performance Implement — Implementation (implementation-done)

Work step of the performance workflow. Executes the optimization plan via the `implementation-plan-executor` skill, then records the implementation outcome in state. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

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
2. List available performance-task identifiers (directories under `.owflow/tasks/performance/`) to resume from, if any.
3. Hint: `Run /owflow:performance <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                                    | Produced by                            |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                              | `/owflow:performance <desc>`           |
| Spec approved           | `implementation/spec.md` exists                                   | `/owflow:performance-spec <task-path>` |
| Plan approved           | `implementation/implementation-plan.md` exists                    | `/owflow:performance-plan <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `implementation-done`): `question` — create a fresh standard performance task starting at this step, or decline → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `implementation-done` is in `completed_phases` and `implementation/work-log.md` exists, backfill `performance_context.phase_summaries.implementation` from the work-log when it is still null, report the existing results, and route to the Exit Gate. If the work-log is missing → drop `implementation-done` and re-run the implementation step.
3. **Prerequisite check (presence and content)**: `implementation/spec.md` AND `implementation/implementation-plan.md` exist. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: specification (`spec-written`) → implementation planning (`plan-created`).
   - `Run /owflow:performance-spec and /owflow:performance-plan <task-path> first` (or `/owflow:performance-analyze <task-path>` for the missing earlier step).
   - If no task exists yet: `Run /owflow:performance <description> to start a task from scratch.`

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

### Implementation (`implementation-done`, delegated)

**Artifacts**: implemented optimizations, `implementation/work-log.md`

> **ANTI-PATTERN — never implement directly. "Simple enough to code inline" is NOT a reason to skip delegation.**
>
> - ❌ "Let me implement this directly..." — STOP. Delegate to `implementation-plan-executor`.
> - ❌ "This is simple enough to code inline..." — STOP. Simplicity is NOT a reason to skip delegation.

1. **INVOKE NOW** (Skill tool — never the Task tool; this skill spawns its own subagents): Skill tool - `implementation-plan-executor`. Pass: task_path, task_description, `performance_context.task_characteristics`, `performance_context.bottleneck_priorities`, and relevant `performance_context.phase_summaries` (specification, bottleneck_analysis, planning). The skill manages its own subagents, incremental tests, plan checkboxes, and `implementation/work-log.md`. Its terminal **full test-suite run** is what makes the template default `skip_test_suite: true` causally safe — do not swap this engine.
2. **SELF-CHECK**: Did you just invoke the Skill tool with `implementation-plan-executor`? Or did you start writing code yourself? If the latter, STOP immediately and invoke the Skill tool instead.
3. **Append this skill's own slug** (replaces the monolith's re-acquire / POST-IMPLEMENTATION block): after the skill returns, re-read `orchestrator-state.yml` to confirm you are the orchestrator, then append `implementation-done` to `completed_phases` and extract a 1-2 sentence summary into `performance_context.phase_summaries.implementation` from `implementation/work-log.md` (task groups completed, files changed, test results, known issues).
4. **State write**: bump `orchestrator.updated`. On failure: append `implementation-done` to `failed_phases`, increment `auto_fix_attempts["implementation-done"]`; partial progress stays documented in `implementation/work-log.md`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`implementation-done`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the implementation fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-performance.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                             | Max Attempts | Strategy                                                             |
| -------------------------------- | ------------ | -------------------------------------------------------------------- |
| Implementation (`implementation-done`) | 5      | Fix syntax, imports, tests; return to the executor for the failing group |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ PERFORMANCE IMPLEMENT COMPLETE — <task name>

**Task groups** — [completed / total]
**Files changed** — [count + key files, 1-3 lines]
**Tests** — [incremental + terminal full-suite results from the executor]
**Known issues** — [deferred items / "none"]

**Artifacts**

- implemented optimizations
- `implementation/work-log.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — implementation matches the plan; continue.
- **Adjust** — re-work the affected task groups (fix code, re-run their tests), update state and work-log, re-present the results box.
- **Discuss** — walk through implementation details (decisions made, files changed, deferred items) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:performance-implement <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:performance-verify <task-path>` — `required` before finalization: picks the additional verification checks and runs the verification pipeline. Remaining after: finalize.

**Other options**:

- `/owflow:goal-performance <task-path>` — `optional` shortcut: runs all remaining steps in one loop (verify → finalize)

Then STOP.
