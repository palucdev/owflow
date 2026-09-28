---
name: owflow:research-quick
description: Research skill — the quick lane. Bootstraps a standard research task and fuses brief, plan + sources, gather, and synthesis into one condensed pass — the only place where the planner delegation, the gatherer fan, and the synthesizer delegation are condensable. Produces the same standard artifacts and state as the full lane; continuable by any research subskill at full fidelity.
argument-hint: "[task-path-or-identifier | \"description\"]"
user-invocable: true
---

# Research Quick — Condensed Brief → Synthesis (brief-written … synthesis-complete)

Quick lane of the research workflow. Bootstraps a standard research task (state file, docs discovery) and then fuses brief, plan + sources, gather, and synthesis into one condensed pass. It does NOT introduce a second state format: the task gets a standard `orchestrator-state.yml` from `orchestrator-state-research.yml` with standard artifacts on the exact paths the full lane uses, so every other research subskill can pick it up afterwards and resume at full fidelity (gather re-fans only missing categories; later subskills treat existing artifacts as pre-existing). State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-plan` (the full-lane owner of the brief and plan steps this lane condenses), `/owflow:research-gather` + `/owflow:research-synthesize` (the full-lane owners of the condensed gather and synthesis steps).

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- **Research question** — anything else (free text, e.g. `"evaluate caching strategies for our API"`) is treated as a new research question for quick bootstrap.

Route by argument kind:

| Situation                                                     | Route                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Task path/identifier, quick lane not yet complete             | Quick pass for the missing pieces (below)                                     |
| Task path/identifier, `synthesis-complete` present            | Quick lane already ran — report existing results and route to the Exit Gate  |
| Research question (or no argument after prompt)               | Quick bootstrap (create task + fused brief → synthesis)                      |
| Missing argument                                              | Prompt for input (path, identifier, or research question), then re-route     |

If the path does **not exist** or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - State initialization (`task.*`) → `/owflow:research <question>`
2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
3. Hint: `Run /owflow:research <question> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill               | Where verified                                        | Produced by                                        |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| State file exists                     | `<task-path>/orchestrator-state.yml`                 | `/owflow:research <question>` (dispatcher init) or the quick bootstrap below |
| Research question resolved (resume)   | `research_context.research_question` non-null in state | quick bootstrap (`brief-written`)                |

1. **Read `orchestrator-state.yml`** from the task path. If missing → quick bootstrap (below). On decline → print the blocked block and STOP.
2. **Content check (resume)**: `research_context.research_question` must be non-null. If null (state exists, question never recorded), prompt via `question` — "What is your research question?" — and let the condensed brief record it in state.
3. **Skip/resume — artifacts before state**: adopt existing artifacts instead of re-running (`planning/research-brief.md` → `brief-written`; `planning/research-plan.md` AND `planning/sources.md` → `plan-created`; findings files → `findings-gathered`; `analysis/synthesis.md` + `outputs/research-report.md` → `synthesis-complete`), then condense ONLY the quick-pass pieces that are still missing. All pieces present → report the existing results and route to the Exit Gate.

## Quick bootstrap (no state file, question argument)

1. **Create Task Directory**: `.owflow/tasks/research/YYYY-MM-DD-task-name/` (3–5 kebab-case words from the question).
2. **Initialize State**: create `orchestrator-state.yml` from the research template with `task.title` / `task.description` from the question, `task.status: in_progress`, and `orchestrator.entry_point: "research-quick"`.
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-research.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section — includes predefined docs AND any user-added project docs — and store them in `research_context.project_doc_paths` (identical to the full lane's brief step).
4. If `.owflow/docs/` does not exist, proceed without project documentation and note the graceful-fallback hint in the completion message: `"No AI SDLC documentation found. Consider running /owflow:flow-init to initialize project documentation and coding standards."`

## Fused condensed pass

**MANDATORY order — brief before plan, plan before gather, gather before synthesis:**

1. **Condensed brief** — run the full lane's brief step inline (parse question, classify type, determine scope, success criteria, write `planning/research-brief.md`, docs discovery when not already done). Append `brief-written` on completion and set `research_context.research_type`, `research_question`, `scope`, and `project_doc_paths` — the same fields the full-lane brief step writes.
2. **Condensed plan + sources — written directly, NO delegation**: read the research-plan skill's `references/research-methodologies.md` using the Read tool (methodology selection still applies), then write `planning/research-plan.md` and `planning/sources.md` as separate artifacts on the exact full-lane paths. **Quick acceptance check: the plan MUST keep a `## Gathering Strategy` section (categories + count)** — this pass uses that count to choose inline gather vs a capped fan; `research-gather` parses the same section and falls back to 4 default categories only when it is absent. **This REPLACES the `research-planner` delegation (the quick lane is the ONLY exception to the plan anti-pattern)**, and it pins the gathering categories: ≤2 categories → the gather step below stays inline with zero agents; more → fan capped at 3. Append `plan-created` on completion and set `research_context.methodology`, `sources`, and `phase_summaries.plan` — the same fields the full-lane plan step writes.
3. **Condensed gather** — when the plan's `## Gathering Strategy` has ≤2 categories, write the per-category finding files into `analysis/findings/` directly, zero agents (**the quick lane is the ONLY exception to the always-fan rule**); with 3+ categories, launch the fan capped at 3 `information-gatherer` agents in ONE message (same mechanics as `/owflow:research-gather`). Append `findings-gathered` on completion; set `research_context.gathering_strategy` and `research_outputs.findings_directory`; note the condensation in `phase_summaries.gather`.
4. **Condensed synthesis — ALWAYS inline**: write `analysis/synthesis.md` (pattern analysis, cross-references, documented gaps and uncertainties) and `outputs/research-report.md` (comprehensive report answering the research question, confidence per finding) directly (**the quick lane is the ONLY exception to the `research-synthesizer` delegation**); set `research_context.confidence_level`, `research_outputs.synthesis`, and `research_outputs.research_report`. Append `synthesis-complete` on completion — condensation noted in `phase_summaries.synthesize`.

Slugs are appended individually on each step's completion — never batched (see State Update Convention). Then continue with the **Exit Gate** below.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`brief-written`, `plan-created`, `findings-gathered`, `synthesis-complete`) plus that step's fields. Never batch multiple steps into one end-of-skill write — each slug lands on its own step's completion, with the same state fields the full-lane owner writes (`methodology`/`sources`, `gathering_strategy`, `research_outputs.findings_directory`/`synthesis`/`research_report`) and condensation noted in `phase_summaries.gather` / `phase_summaries.synthesize`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                          | Max Attempts | Strategy                                              |
| ----------------------------- | ------------ | ----------------------------------------------------- |
| Brief (`brief-written`)       | 1            | Prompt user for clarification if question unclear     |
| Plan (`plan-created`)         | 2            | Expand search patterns, use fallback mixed methodology |
| Gather (`findings-gathered`)  | 1            | Re-run the failed category only (inline or capped fan) |
| Synthesis (`synthesis-complete`) | 1         | Re-write from existing findings and report inputs     |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH QUICK COMPLETE — <research question>

**Type** — [research type]
**Methodology** — [methodology summary from state]
**Gathering categories** — [N categories in the plan's Gathering Strategy]
**Pass** — brief → plan → gather → synthesis fused inline

**Artifacts**

- `planning/research-brief.md`
- `planning/research-plan.md` (keeps the parsable `## Gathering Strategy` section)
- `planning/sources.md`
- `analysis/findings/*.md`
- `analysis/synthesis.md`
- `outputs/research-report.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the condensed-pass artifacts are good; continue.
- **Adjust** — re-run only the affected quick-pass piece (brief, plan, gather, or synthesis) with the user's corrections, update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific part (research type, methodology, findings, report) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-quick <task-path>`) and end.

### Next steps (after Accept)

The task is a regular research task — the optional chain is the user's choice from here:

- `→ /owflow:research-brainstorm <task-path>` — brainstorm solution alternatives (→ converge → design, when wanted).
- `→ /owflow:research-design <task-path>` — design-only branch, seeded from the research report.
- `→ /owflow:research-finalize <task-path>` — no optional chain: inventories the outputs and completes the task.

Then STOP.
