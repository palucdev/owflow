---
name: owflow:performance-analyze
description: Performance — codebase analysis with clarifications, then static bottleneck identification via delegation. First work step of the performance workflow; continues with performance-spec.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Performance Analyze — Codebase & Bottleneck Analysis (codebase-analysed, bottlenecks-identified)

Work step of the performance workflow. Explores the codebase for performance context, gathers clarifications, then delegates static bottleneck identification (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks, caching opportunities) to the `bottleneck-analyzer` agent. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

The performance metrics and optimization-pattern reference lives in this skill's own folder (`references/performance-optimization-guide.md`).

Related entry points: `/owflow:performance` (assisted mode), `/owflow:goal-performance` (autonomous mode). Both produce the same state; you may mix them freely.

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/performance/` (e.g., `2026-10-02-api-latency`); resolve to its path.
- **Description** — anything else (free text) is treated as a new performance task description: ask via `question` whether to start a fresh standard task at this step (mid-pipeline bootstrap) or route through `/owflow:performance <description>`; on decline, print the blocked block and STOP.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Prerequisites: none — this is the first work step. Everything else requires it.
2. List available performance-task identifiers (directories under `.owflow/tasks/performance/`) to resume from, if any.
3. Hint: `Run /owflow:performance <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill    | Where verified                                  | Produced by                  |
| -------------------------- | ----------------------------------------------- | ---------------------------- |
| State file exists          | `<task-path>/orchestrator-state.yml`            | `/owflow:performance <desc>` |
| Task description recorded  | `task.description` non-null in state            | `/owflow:performance <desc>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `codebase-analysed`): `question` — create a fresh standard performance task starting at this step, or decline → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
2. **Content check**: if `task.description` is null, ask via `question` — "What is slow or performance-constrained? Describe the symptom (endpoint, page, job), expected vs actual behavior, and any profiling data you have." — and record it in `task.description` before proceeding.
3. **Skip/resume (artifacts before state)**: if `codebase-analysed` is in `completed_phases`, validate `analysis/codebase-analysis.md` exists; missing → drop the slug and re-run that step. If both `codebase-analysed` and `bottlenecks-identified` are complete (validated against `analysis/performance-analysis.md`), report existing results and route to the Exit Gate. If only `codebase-analysed` is complete, skip to the bottleneck step.

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) and the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md).

### Codebase Analysis (`codebase-analysed`)

**Artifacts**: `analysis/codebase-analysis.md`, `analysis/clarifications.md`

> **ANTI-PATTERN — never run the codebase analysis yourself. "The codebase is small" is NOT a reason to skip delegation.**
>
> - ❌ "Let me explore the codebase myself..." — STOP. Delegate to `codebase-analyzer`.
> - ❌ "I'll read a few key files and summarize..." — STOP. Delegate to `codebase-analyzer`.

1. **INVOKE NOW** (Skill tool — never the Task tool; this skill spawns its own subagents): Skill tool - `codebase-analyzer`. Pass: task description (`task.description`), task_path, performance-focused guidance (database query patterns, hot code paths, I/O operations, caching layers, connection management, schema/migration files), `performance_context.project_doc_paths` from state, and any files present in `analysis/user-profiling-data/`. The analyzer adaptively selects parallel Explore agents based on complexity.
2. **SELF-CHECK**: Did you just invoke the Skill tool with `codebase-analyzer`? Or did you start exploring code yourself? If the latter, STOP and invoke the Skill tool.
3. Direct - use `question` for max 5 critical clarifying questions about performance concerns, hotspots, and optimization goals. Save to `analysis/clarifications.md`; record the outcome in `performance_context.phase_summaries.clarifications` (summary).
4. **State write**: append `codebase-analysed` to `completed_phases`; update `performance_context.phase_summaries.codebase_analysis` (`key_files` + summary); bump `orchestrator.updated`. On failure: append `codebase-analysed` to `failed_phases`, increment `auto_fix_attempts["codebase-analysed"]`. Then re-read state + run `verify_template` (see State Update Convention).

### Bottleneck Analysis (`bottlenecks-identified`)

**Artifacts**: `analysis/performance-analysis.md`

> **ANTI-PATTERN — never analyze bottlenecks yourself. "The patterns are obvious" is NOT a reason to skip delegation.**
>
> - ❌ "Let me analyze the bottlenecks myself..." — STOP. Delegate to `bottleneck-analyzer`.
> - ❌ "I'll grep for N+1 patterns..." — STOP. Delegate to `bottleneck-analyzer`.

1. **Read `references/performance-optimization-guide.md` NOW using the Read tool** — performance metrics vocabulary and optimization patterns (the reference lives in this skill's own folder). Use it to frame the context you pass to the agent and to interpret its findings.
2. Check `analysis/user-profiling-data/`. If empty, `question` — "Do you have profiling data to provide (flame graphs, APM screenshots, slow query logs)?" with options "Yes, let me add files to analysis/user-profiling-data/" / "No, proceed with static analysis only". If the user adds files, wait for them, then continue.
3. **INVOKE NOW** (Task tool — never the Skill tool; this is an agent): Task tool - `bottleneck-analyzer` subagent. Pass (Pattern 7 — accumulated context): task_path, task description, the codebase-analysis summary from `performance_context.phase_summaries.codebase_analysis`, user-data paths (if any), `performance_context.project_doc_paths`, and relevant `performance_context.phase_summaries`. Output: `analysis/performance-analysis.md`.
4. **Extract structured data from the result** (this gates later steps — do not summarize only): read the bottleneck count into `performance_context.bottlenecks_identified`, the P0-P3 split into `performance_context.bottleneck_priorities.p0…p3`, and `performance_context.user_data_available`; write the bottleneck list and a 1-2 sentence summary into `performance_context.phase_summaries.bottleneck_analysis`. Also set `performance_context.task_characteristics` from the findings (consumed by `specification-creator` and `implementation-planner`): `modifies_existing_code: true`; `involves_data_operations: true` when data-layer access (queries, indexes, schema) is implicated; `creates_new_entities: true` when the fix introduces new components (e.g., a cache layer); `ui_heavy: true` when hot paths are UI rendering; `has_reproducible_defect` stays `false`.
5. **SELF-CHECK**: Did you just invoke the Task tool with `bottleneck-analyzer`? Or did you start analyzing code yourself? If the latter, STOP and invoke the Task tool.
6. **State write**: append `bottlenecks-identified` to `completed_phases`; update `performance_context.bottlenecks_identified`, `performance_context.user_data_available`, `performance_context.bottleneck_priorities`, `performance_context.task_characteristics`, and `performance_context.phase_summaries.bottleneck_analysis`; bump `orchestrator.updated`. On failure: append `bottlenecks-identified` to `failed_phases`, increment `auto_fix_attempts["bottlenecks-identified"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`codebase-analysed`, `bottlenecks-identified`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-performance.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                                        | Max Attempts | Strategy                                              |
| ------------------------------------------- | ------------ | ----------------------------------------------------- |
| Codebase Analysis (`codebase-analysed`)     | 2            | Expand search scope, prompt user for hints            |
| Bottleneck Analysis (`bottlenecks-identified`) | 2          | Re-analyze with broader patterns, ask user for hotspots |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ PERFORMANCE ANALYZE COMPLETE — <task name>

**Codebase** — [key files/modules from performance_context.phase_summaries.codebase_analysis]
**Bottlenecks** — [N identified: X P0 / Y P1 / Z P2 / W P3]
**User data** — [incorporated / static analysis only]
**Clarifications** — [key answers / "none needed"]

**Artifacts**

- `analysis/codebase-analysis.md`
- `analysis/clarifications.md`
- `analysis/performance-analysis.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — analysis is good; continue.
- **Adjust** — re-run only the affected step (codebase analysis, clarifications, or bottleneck analysis), update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific result (bottleneck prioritization, missing-index evidence, improvement estimates) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:performance-analyze <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:performance-spec <task-path>` — `required` next: gathers optimization priorities, constraints, and targets, then writes the specification. Remaining after: plan → implement → verify → finalize.

**Other options**:

- `/owflow:goal-performance <task-path>` — `optional` shortcut: runs all remaining steps in one loop (spec → plan → implement → verify → finalize)

Then STOP.
