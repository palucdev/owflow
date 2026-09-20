---
name: dev-analyze
description: Development — codebase analysis with clarifications, then gap analysis with scope decisions. First work phase of the development workflow.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Analyze — Phases 1–2 (Codebase & Gap Analysis)

Work phase of the development workflow. Runs codebase exploration, requirements clarification, gap analysis, and scope decisions for an existing development task. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related entry points: `/owflow:development` (handoff mode), `/owflow:goal-development` (loop mode). Both produce the same state; you may mix them freely.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Prerequisites: none — this is the first work phase. Everything else requires it.
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                                          | Produced by                      |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                                    | `/owflow:development <desc>`     |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `phase-1` is in `completed_phases`, skip that part. If `phase-2` is in `completed_phases`, the whole phase is done — report existing results and route to the Exit Gate.

## Execute

**Read first**: Section 1 (Delegation Rules) and Section 7 (Dispatcher & Handoff Pattern) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Part A — Codebase Analysis (Phase 1)

1. Skill tool - `codebase-analyzer`. Pass: task description (`task.description`), task_path, risk-relevant state, `project_doc_paths` from state, research/quick-reference context if present in state.
2. Direct - use `question` for max 5 critical clarifying questions. Save to `analysis/clarifications.md`; set `task_context.clarifications_resolved`.
3. **State write (Phase 1)**: append `phase-1` to `completed_phases`; update `task_context.risk_level`, `task_context.clarifications_resolved`, `phase_summaries.codebase_analysis`; bump `orchestrator.updated`. On failure: append `phase-1` to `failed_phases`, increment `auto_fix_attempts["phase-1"]`. Then re-read state + run `verify_template` (see State Update Convention).

### Part B — Gap Analysis & Scope (Phase 2)

1. Task tool - `gap-analyzer` subagent. Pass: task_path, risk level, codebase summary, key files, clarifications, `project_doc_paths`.
2. **Extract structured data from the result** (this gates later phases — do not summarize only):
   - Read `task_characteristics` (5 fields: `has_reproducible_defect`, `modifies_existing_code`, `creates_new_entities`, `involves_data_operations`, `ui_heavy`) → write to `task_context.task_characteristics`
   - Read `risk_level` → `task_context.risk_level`
   - Write 1-2 sentence summary to `phase_summaries.gap_analysis`
   - **SELF-CHECK**: re-read `orchestrator-state.yml` and verify the 5 characteristic values match the gap-analyzer output.
3. **Decision gate** (mandatory): if `decisions_needed.critical` or `decisions_needed.important` is non-empty → `question` (one per critical; batch important into multi-select). If empty, note "No scope decisions needed" in state.
4. Save scope clarifications to `analysis/scope-clarifications.md` (conditional).
5. **Optional phase defaults**: `ui_heavy: true` → `options.e2e_enabled: true` + `options.user_docs_enabled: true`; `creates_new_entities: true` → `options.user_docs_enabled: true`. Command flags in state (`options`) already set override these.
6. **State write (Phase 2)**: append `phase-2` to `completed_phases`; update `task_context.task_characteristics`, `task_context.risk_level`, `phase_summaries.gap_analysis`; record decision-gate outcome (or "No scope decisions needed") in `task_context.gaps`; apply option defaults to `options.*`; bump `orchestrator.updated`. On failure: append `phase-2` to `failed_phases`, increment `auto_fix_attempts["phase-2"]`. Then re-read state + run `verify_template`.

**ANTI-PATTERN**: Do NOT override `ui_heavy` with your own complexity judgment ("no new screens needed, just..."). It is a gap-analyzer signal.

## State Update Convention (per step)

Apply after EVERY phase/step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the `phase-N` entry actually performed plus that step's fields. Never batch multiple phases into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append `phase-N` to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-N"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then hand off (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```
═══════════════════════════════════════════════════════
  DEV ANALYZE COMPLETE: <task name>
═══════════════════════════════════════════════════════
  Task type:     [detected type]
  Risk level:    [risk_level from state]
  Characteristics: [key characteristics — TDD gate, E2E, user docs]
  Scope decisions: [decisions made / "none needed"]

  Artifacts:
    - analysis/codebase-analysis.md
    - analysis/clarifications.md
    - analysis/gap-analysis.md
    - analysis/scope-clarifications.md   [conditional]
═══════════════════════════════════════════════════════
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — analysis is good; continue.
- **Adjust** — re-run only the affected part (clarifications, gap analysis, or scope decisions), update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific result (risk level rationale, characteristics, scope decisions) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-analyze <task-path>`) and end.

### Next steps (after Accept)

Read `task_context.task_characteristics` from state and print the suggested command:

- `has_reproducible_defect: true` → `→ /owflow:dev-tdd-red <task-path>`
- otherwise → `→ /owflow:dev-spec <task-path>`

**Other options**:

- `/owflow:goal-development <task-path>` — continue remaining phases in one loop
- `/owflow:dev-spec <task-path>` — skip TDD gate manually (not recommended for reproducible defects)

Then STOP.
