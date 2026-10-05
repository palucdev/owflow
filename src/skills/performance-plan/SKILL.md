---
name: owflow:performance-plan
description: Performance — breaks the approved specification into a grouped, dependency-ordered implementation plan via delegation, then adds an execution-flow diagram. Continues with performance-implement.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Performance Plan — Implementation Planning (plan-created)

Work step of the performance workflow. Breaks the approved optimization specification into grouped, dependency-ordered task groups via the `implementation-planner` agent, then adds an execution-flow diagram. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/performance/` (e.g., `2026-10-02-api-latency`); resolve to its path.
- **Description** — anything else (free text) is treated as a new performance task description: ask via `question` whether to start a fresh standard task at this step (mid-pipeline bootstrap) or route through `/owflow:performance <description>`; on decline, print the blocked block and STOP.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - Codebase & bottleneck analysis (`codebase-analysed`, `bottlenecks-identified`) → `/owflow:performance-analyze <task-path>`
   - Requirements, specification & conditional audit (`spec-written`, `spec-audited`) → `/owflow:performance-spec <task-path>`
2. List available performance-task identifiers (directories under `.owflow/tasks/performance/`) to resume from, if any.
3. Hint: `Run /owflow:performance <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill   | Where verified                                                                        | Produced by                              |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| State file exists         | `<task-path>/orchestrator-state.yml`                                                  | `/owflow:performance <desc>`             |
| Specification approved    | `spec-written` in `completed_phases` + `implementation/spec.md` exists                | `/owflow:performance-spec <task-path>`   |
| Audit decision settled    | `options.spec_audit_enabled` non-null                                                 | `/owflow:performance-spec <task-path>`   |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `plan-created`): `question` — create a fresh standard performance task starting at this step, or decline → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
2. **Skip/resume (artifacts before state)**: if `plan-created` is complete and `implementation/implementation-plan.md` exists, report the existing plan summary and route to the Exit Gate. If the file exists but its slug is missing, adopt it (append `plan-created`, backfill `performance_context.phase_summaries.planning` when still null) instead of re-running. A slug whose artifact is missing → drop the slug and re-run that step.
3. **Prerequisite check (presence and content)**: `spec-written` in `completed_phases` AND `implementation/spec.md` exists — the spec must be user-approved before the planner is invoked — AND `options.spec_audit_enabled` is non-null (the audit decision is settled). If missing → print the blocked block, then STOP:
   - Steps that must be completed first: specification and its audit decision (`spec-written`, audit settled).
   - `Run /owflow:performance-spec <task-path> first` (or `/owflow:performance-analyze <task-path>` for the missing earlier step).
   - If no task exists yet: `Run /owflow:performance <description> to start a task from scratch.`

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) and the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md).

### Implementation Planning (`plan-created`, delegated)

**Artifacts**: `implementation/implementation-plan.md`

> **ANTI-PATTERN — never write the implementation plan yourself. "The optimization list is short" is NOT a reason to skip delegation.**
>
> - ❌ "Let me create the implementation plan..." — STOP. Delegate to `implementation-planner`.
> - ❌ "I'll break this into optimization steps..." — STOP. Delegate to `implementation-planner`.

1. **INVOKE NOW** (Task tool — never the Skill tool; this is an agent): Task tool - `implementation-planner` subagent. Pass (Pattern 7 — accumulated context): task_path, task_type="performance", task_description, spec_path (`implementation/spec.md`), `performance_context.task_characteristics`, `performance_context.bottleneck_priorities`, and relevant `performance_context.phase_summaries` (specification, bottleneck_analysis, codebase_analysis). Output: `implementation/implementation-plan.md`.
2. **SELF-CHECK**: Did you just invoke the Task tool with `implementation-planner`? Or did you start writing the plan yourself? If the latter, STOP and invoke the Task tool.
3. **Post-plan diagram refinement** (Skill, optional, content-preserving): Skill tool - `diagrams-mermaid` on `implementation/implementation-plan.md` — add one compact optimization execution flow (task-group dependency or state flow). Keep plan steps authoritative; diagrams are explanatory additions only. A declined or failed refinement is not a failure — note it in `performance_context.phase_summaries.planning`.
4. **State write**: append `plan-created` to `completed_phases`; set `performance_context.phase_summaries.planning` (task-group count, step count, optimization sequence); bump `orchestrator.updated`. On failure: append `plan-created` to `failed_phases`, increment `auto_fix_attempts["plan-created"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`plan-created`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-performance.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                          | Max Attempts | Strategy                                          |
| ----------------------------- | ------------ | ------------------------------------------------- |
| Implementation Planning (`plan-created`) | 2  | Regenerate the plan with adjusted spec context    |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ PERFORMANCE PLAN COMPLETE — <task name>

**Task groups** — [N groups / M steps]
**Optimization sequence** — [key dependency order]
**Spec** — [approved spec summary in 1 line]
**Diagram** — [added / skipped]

**Artifacts**

- `implementation/implementation-plan.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the plan is good; continue.
- **Adjust** — regenerate the plan with the user's corrections, update state and artifacts, re-present the results box.
- **Discuss** — walk through the plan's task groups, dependencies, or test strategy in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:performance-plan <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:performance-implement <task-path>` — `required` next: executes the plan via `implementation-plan-executor` (its terminal full-suite run is what keeps `skip_test_suite: true` safe). Remaining after: verify → finalize.

**Other options**:

- `/owflow:goal-performance <task-path>` — `optional` shortcut: runs all remaining steps in one loop (implement → verify → finalize)

Then STOP.
