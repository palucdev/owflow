---
name: owflow:research-gather
description: Research skill — reads the plan's Gathering Strategy and launches the parallel information-gatherer agent fan in ONE message, then merges per-category findings. Ends the gathering step of the research workflow (findings-gathered) and continues with research-synthesize.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Gather — Parallel Findings Fan (findings-gathered)

Work phase of the research workflow. Reads the gathering strategy out of the research plan and launches the parallel information-gatherer fan (`analysis/findings/*.md`, one file per category). State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-plan` (produces the plan this skill parses), `/owflow:research-synthesize` (consumes the merged findings). In the quick lane, `research-quick` may author findings inline — those are pre-existing category files for this skill.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Research brief & plan (`brief-written`, `plan-created`) → `/owflow:research-plan <task-path>`
  2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
  3. Hint: `Run /owflow:research-plan <task-path> first, /owflow:research <question> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill            | Where verified                                                      | Produced by                            |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| State file exists                  | `<task-path>/orchestrator-state.yml`                                 | `/owflow:research <question>` or `/owflow:research-quick` |
| Plan exists                        | `plan-created` in `completed_phases` + `planning/research-plan.md` exists | `/owflow:research-plan <task-path>`    |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `findings-gathered`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Content check — plan file**: Read `planning/research-plan.md`. If the file is missing → print the blocked block, then STOP (`Run /owflow:research-plan <task-path> first.`). A missing `## Gathering Strategy` section does NOT block — Execute falls back to the default 4 categories.
3. **Skip/resume — only missing categories re-fan**: existing files under `analysis/findings/` count as done whether or not `findings-gathered` is already in `completed_phases` (artifacts before state; quick-lane and pre-split files included). Re-fan ONLY categories with no matching file, then append `findings-gathered` once every planned category has a file. All categories already present → adopt the slug if it is missing, report existing findings, and route to the Exit Gate.

## Execute (delegated fan)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

**Scope**: normal runs — findings authored by the `research-quick` lane are treated as pre-existing category files (Entry Gate resume check) and are NOT re-gathered.

### The `information-gatherer` agent

Each gathering category is delegated to ONE `information-gatherer` subagent via the Task tool — one agent per category, N categories → N agents. The agent receives the category id and the task context and writes that category's findings file itself; this skill only launches the fan and merges the results. Never gather category findings inline in this skill.

### Determine the gatherer count and categories

1. Read the **Gathering Strategy** section from `planning/research-plan.md`
2. If gathering strategy found: use specified categories and count (cap at 8 max)
3. If no gathering strategy: fall back to the default 4 categories — codebase, documentation, configuration, external — and set `source: default`
4. Update state: `research_context.gathering_strategy`

**CRITICAL: Launch all N `information-gatherer` agents in ONE message for parallel execution.**

**Parallel Execution Pattern**:

```
Read gathering strategy from planning/research-plan.md
For each category in strategy:
  Use Task tool: information-gatherer with source_category=[category_id] → analysis/findings/[prefix]-*.md
```

> **ANTI-PATTERN — never launch the gatherer fan as sequential Task calls or via the Skill tool. The `information-gatherer` agents go through the Task tool, one call per category, all N calls in ONE message.**

### Output artifact & handoff to research-synthesize

The output artifact of this skill is the **findings directory**: `analysis/findings/*.md`, exactly one file per gathering category (`[prefix]-*.md`, e.g. `codebase-*.md`, `docs-*.md`, plus any custom categories). `research_outputs.findings_directory` records that path in state.

`research-synthesize` consumes exactly these files: it reads every `analysis/findings/*.md` (the Entry Gate verifies one file per planned category exists), cross-references them in `analysis/synthesis.md`, and feeds the merged evidence into `outputs/research-report.md`. Nothing else from this skill flows downstream — the findings files ARE the contract.

### Merge & close (`findings-gathered`)

1. Verify one findings file per category exists under `analysis/findings/`
2. **State write**: append `findings-gathered` to `completed_phases`; update `research_context.gathering_strategy`, `phase_summaries.gather`; set `research_outputs.findings_directory`; bump `orchestrator.updated`. On failure (or a category permanently failing): append `findings-gathered` to `failed_phases`, increment `auto_fix_attempts["findings-gathered"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`findings-gathered`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["findings-gathered"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                          | Max Attempts | Strategy                                                      |
| ----------------------------- | ------------ | ------------------------------------------------------------- |
| Gather (`findings-gathered`)  | 3            | Retry failed agents only, continue with successful categories |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH GATHER COMPLETE — <research question>

**Categories** — [N gathered / M planned]
**Findings files** — [list of `analysis/findings/*.md` files]
**Source** — [planner-specified strategy / default 4-category fallback]

**Artifacts**

- `analysis/findings/*.md` ([per category])
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the findings are good; continue.
- **Adjust** — re-run only the affected categories (missing/failed agents only — successful category files stay), update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific category's findings in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-gather <task-path>`) and end. Note: on a later resume, only the missing categories re-fan.

### Next steps (after Accept)

- `→ /owflow:research-synthesize <task-path>` — `required` next: delegates the synthesis agent for pattern analysis (`analysis/synthesis.md`) + the comprehensive research report (`outputs/research-report.md`) with confidence per finding. Remaining after: scope → optional chain → finalize.

Then STOP.
