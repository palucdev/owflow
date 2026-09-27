---
name: owflow:research-plan
description: Research skill — creates the research brief, delegates methodology selection and planning to the research-planner agent, and writes the research plan with a parsable Gathering Strategy. First work phase of the research workflow; continues with research-gather (full lane) or research-scope (quick). --quick starts a condensed research task here that fuses brief, plan, gather, and synthesis into one pass.
argument-hint: "[task-path-or-identifier | \"description\"] [--quick]"
user-invocable: true
---

# Research Plan — Brief, Methodology & Plan (brief-written, plan-created)

Work phase of the research workflow. Creates the research brief, delegates methodology selection and gathering-strategy planning to the research-planner agent, and writes the research plan. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Supports a **quick mode** (`--quick` only): a condensed lane that bootstraps a standard research task (state file, docs discovery) and then fuses brief, plan + sources, gather, and synthesis into one pass — quick mode is the ONLY place where the planner delegation, the gatherer fan, and the synthesizer delegation are condensable. A research question without `--quick` is not quick mode — the routing table asks first. After the Exit Gate, the pipeline continues with `/owflow:research-gather` (full lane) or `/owflow:research-scope` (quick). The task is a regular research task, resumable by any research subskill at full fidelity.

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- **Research question** — anything else (free text, e.g. `"evaluate caching strategies for our API"`) is treated as a new research question for quick bootstrap (without `--quick`, the routing table asks first).

Route by argument kind and flags:

| Situation                                                     | Route                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Task path/identifier, no `--quick`, state + question present  | Full lane below (brief step → plan step)                                     |
| Task path/identifier, `--quick`, quick lane not yet complete  | Quick pass for the missing pieces, then condensed continuation (see Quick Mode) |
| Task path/identifier, `--quick`, `synthesis-complete` present | Quick lane already ran — report existing results and route to the Exit Gate  |
| Research question, `--quick` (or no argument after prompt)    | Quick bootstrap (create task + fused brief → synthesis)                      |
| Research question, no `--quick`                               | Ask via `question`: quick fused task / full pipeline through the dispatcher (blocked block below) / cancel |
| Missing argument                                              | Prompt for input (path, identifier, or research question), then re-route     |

If the path does **not exist** or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - State initialization (`task.*`, `options.*` from flags) → `/owflow:research <question>`
2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
3. Hint: `Run /owflow:research <question> to start a task from scratch, /owflow:research-plan --quick "<question>" for a quick fused task, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill               | Where verified                                        | Produced by                                        |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| State file exists                     | `<task-path>/orchestrator-state.yml`                 | `/owflow:research <question>` (dispatcher init) or the quick bootstrap |
| Research question resolved (resume)   | `research_context.research_question` non-null in state | brief step (`brief-written`) or quick bootstrap  |

1. **Read `orchestrator-state.yml`** from the task path. If missing → quick bootstrap only when invoked with `--quick` (see Quick Mode). A question argument without `--quick` follows the routing table (ask first). Otherwise mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `brief-written`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch, or /owflow:research-plan --quick "<question>" for a quick fused task.` and STOP.
2. **Legacy state**: tasks created before the slug re-key still carry `phase-N` keys and lack `entry_point`, `project_doc_paths`, `research_outputs.synthesis`, and the slug-keyed `auto_fix_attempts` / `phase_summaries` slots. Before the first write, add every key the current `orchestrator-state-research.yml` declares and that verify_template would report missing. Do not translate `phase-N` entries in `completed_phases` into slugs — adopt from artifacts (step 4) instead. Extra `phase-N` keys may stay; they do not fail verify_template.
3. **Content check (resume)**: `research_context.research_question` must be non-null. If null (state exists, question never recorded), prompt via `question` — "What is your research question?" — and let the brief step record it in state.
4. **Skip/resume** — artifacts before state. If the file exists but its slug is missing, adopt it (append the slug, backfill still-null fields) instead of re-running:
   - `planning/research-brief.md` exists → append `brief-written` if missing, then skip the brief step.
   - `planning/research-plan.md` AND `planning/sources.md` exist → append `plan-created` if missing, backfill `methodology` / `sources` / `phase_summaries.plan` when still null, report the existing plan summary, and route to the Exit Gate (a `--quick` resume instead condenses only the quick-pass pieces that are still missing).
   - A slug whose artifact is missing → drop the slug and re-run that step.
5. **`--quick` honored**: any `--quick` invocation routes into Quick Mode below regardless of argument kind. The dispatcher and `goal-research` never forward `--quick`; an interrupted quick task resumes here in condensed mode only when the user passes `--quick` again.

## Quick Mode (condensed brief → synthesis, one pass)

Quick mode produces the same artifacts as the full lane — just condensed into one pass inside this skill. It does NOT introduce a second state format: the task gets a standard `orchestrator-state.yml` from `orchestrator-state-research.yml` with standard artifacts on the exact paths the full lane uses, so every other research subskill can pick it up afterwards and resume at full fidelity (gather re-fans only missing categories; later subskills treat existing artifacts as pre-existing).

### Quick bootstrap (no state file, question argument)

1. **Create Task Directory**: `.owflow/tasks/research/YYYY-MM-DD-task-name/` (3–5 kebab-case words from the question).
2. **Initialize State**: create `orchestrator-state.yml` from the research template with `task.title` / `task.description` from the question, `task.status: in_progress`, and `orchestrator.entry_point: "research-plan --quick"`.
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-research.yml`.
3. **Discover project documentation**: read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section — includes predefined docs AND any user-added project docs — and store them in `research_context.project_doc_paths` (identical to the full lane's brief step).
4. If `.owflow/docs/` does not exist, proceed without project documentation and note the graceful-fallback hint in the completion message: `"No AI SDLC documentation found. Consider running /owflow:flow-init to initialize project documentation and coding standards."`

### Fused condensed pass

**MANDATORY order — brief before plan, plan before gather, gather before synthesis:**

1. **Condensed brief** — run the full lane's brief step inline (parse question, classify type, determine scope, success criteria, write `planning/research-brief.md`, docs discovery when not already done). Append `brief-written` on completion and set `research_context.research_type`, `research_question`, `scope`, and `project_doc_paths` — the same fields the full-lane brief step writes.
2. **Condensed plan + sources — written directly, NO delegation**: read `references/research-methodologies.md` using the Read tool (methodology selection still applies), then write `planning/research-plan.md` and `planning/sources.md` as separate artifacts on the exact full-lane paths. **Quick acceptance check: the plan MUST keep a `## Gathering Strategy` section (categories + count)** — this pass uses that count to choose inline gather vs a capped fan; `research-gather` parses the same section and falls back to 4 default categories only when it is absent. **This REPLACES the research-planner delegation in Execute below (quick mode is the only exception to the plan anti-pattern)**, and it pins the gathering categories: ≤2 categories → the gather step below stays inline with zero agents; more → fan capped at 3. Append `plan-created` on completion and set `research_context.methodology`, `sources`, and `phase_summaries.plan` — the same fields the full-lane plan step writes.
3. **Condensed gather** — when the plan's `## Gathering Strategy` has ≤2 categories, write the per-category finding files into `analysis/findings/` directly, zero agents (**quick mode is the ONLY exception to the always-fan rule**); with 3+ categories, launch the fan capped at 3 gatherers in ONE message (same mechanics as `/owflow:research-gather`). Append `findings-gathered` on completion; set `research_context.gathering_strategy` and `research_outputs.findings_directory`; note the condensation in `phase_summaries.gather`.
4. **Condensed synthesis — ALWAYS inline**: write `analysis/synthesis.md` (pattern analysis, cross-references, documented gaps and uncertainties) and `outputs/research-report.md` (comprehensive report answering the research question, confidence per finding) directly (**quick mode is the ONLY exception to the research-synthesizer delegation**); set `research_context.confidence_level`, `research_outputs.synthesis`, and `research_outputs.research_report`. Append `synthesis-complete` on completion — condensation noted in `phase_summaries.synthesize`.

Slugs are appended individually on each step's completion — never batched (see State Update Convention). Then continue with the **Exit Gate** below; its results box notes the condensed pass.

## Execute (full lane — inline brief, delegated planning)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) and the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md).

**Scope**: normal runs only — quick mode fuses everything inline (see Quick Mode) and skips this section.

### Brief (`brief-written`, inline)

**Artifacts**: `planning/research-brief.md`
**Resume check**: if `planning/research-brief.md` exists, adopt it (append `brief-written` if that slug is missing) and skip to the plan step.

1. Parse research question (from command or prompt user)
2. Classify research type. If `research_context.research_type` is already one of `technical`, `requirements`, `literature`, `mixed` (the dispatcher or `goal-research` wrote it from `--type`), keep that value. The template placeholder `"technical | requirements | literature | mixed"` is not a classification — auto-detect from keywords in that case. This skill's own command does not take `--type`.
3. Determine scope (included, excluded, constraints)
4. Define success criteria
5. Create research brief
6. Update state: set `research_context.research_type`, `research_question`, `scope`
7. **Discover project documentation**: Read `.owflow/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section — includes predefined docs AND any user-added project docs. Store as `research_context.project_doc_paths` in state.

**State write**: append `brief-written` to `completed_phases` (the brief step's fields above go in with it); bump `orchestrator.updated`. On failure: append `brief-written` to `failed_phases`, increment `auto_fix_attempts["brief-written"]`. Then re-read state + run `verify_template` (see State Update Convention).

### Plan (`plan-created`, delegated)

**Artifacts**: `planning/research-plan.md`, `planning/sources.md`
**Resume check**: if `planning/research-plan.md` AND `planning/sources.md` exist, adopt them (append `plan-created` if that slug is missing; backfill `methodology`, `sources`, and `phase_summaries.plan` when still null) and skip to the Exit Gate.

> **ANTI-PATTERN — never write the research plan yourself in a full-lane run. "The question is simple" is NOT a reason to skip delegation. (Quick mode is the ONLY exception — its condensed pass step 2 writes the plan directly and skips this step.)**

1. **Read `references/research-methodologies.md` NOW using the Read tool** — research type classification, methodology selection, gathering strategies (the reference lives in this skill's own folder).
2. **INVOKE NOW**: Task tool - `research-planner` subagent (never the Skill tool — this is an agent). Pass (Pattern 7 — accumulated context): task_path, research_brief_path, research_type, research_question, scope, project_doc_paths (from state). Output: `planning/research-plan.md`, `planning/sources.md`.
3. **Plan parsability**: the plan SHOULD keep a `## Gathering Strategy` section (categories + count). `research-gather` parses that section; if the planner omitted it, do NOT hand-author the section in a full-lane run — note the omission in `phase_summaries.plan` and let gather fall back to its default 4 categories.
4. **State write**: append `plan-created` to `completed_phases`; update `research_context.methodology`, `sources`, `phase_summaries.plan`; bump `orchestrator.updated`. On failure: append `plan-created` to `failed_phases`, increment `auto_fix_attempts["plan-created"]`. Then re-read state + run `verify_template`.

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (e.g. `brief-written`, `plan-created`) plus that step's fields. Never batch multiple steps into one end-of-skill write. In quick mode, the prelude steps follow the same rule: `brief-written` after the condensed brief, `plan-created` after the condensed plan + sources, `findings-gathered` after the condensed gather, `synthesis-complete` after the condensed synthesis — each on its own completion, with the same state fields the full-lane owner writes (`methodology`/`sources`, `gathering_strategy`, `research_outputs.findings_directory`/`synthesis`/`research_report`) and condensation noted in `phase_summaries.gather` / `phase_summaries.synthesize`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                        | Max Attempts | Strategy                                              |
| --------------------------- | ------------ | ----------------------------------------------------- |
| Brief (`brief-written`)     | 1            | Prompt user for clarification if question unclear     |
| Plan (`plan-created`)       | 2            | Expand search patterns, use fallback mixed methodology |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH PLAN COMPLETE — <research question>

**Type** — [research type]
**Methodology** — [methodology summary from state]
**Gathering categories** — [N categories in the plan's Gathering Strategy]
**Entry point** — [quick bootstrap (`--quick`) / full lane]
**Condensed pass** — [brief → synthesis fused inline / not applicable (full lane)]

**Artifacts**

- `planning/research-brief.md`
- `planning/research-plan.md` (keeps the parsable `## Gathering Strategy` section)
- `planning/sources.md`
- `analysis/findings/*.md` [quick only]
- `analysis/synthesis.md` [quick only]
- `outputs/research-report.md` [quick only]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the brief/plan (and quick-pass artifacts) are good; continue.
- **Adjust** — re-run only the affected step (brief, plan, or the quick-pass pieces) with the user's corrections, update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific part (research type, methodology, gathering strategy) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-plan <task-path>`) and end.

### Next steps (after Accept)

- Full lane → `→ /owflow:research-gather <task-path>` — `required` next: launches the parallel gatherer fan and merges per-category findings (`findings-gathered`), then `research-synthesize` fuses synthesis + research report. Remaining after: scope → optional chain → finalize.
- Quick lane → `→ /owflow:research-scope <task-path>` — `required` next: resolves both enablement decisions (`options.brainstorming_enabled`, `options.design_enabled`); the quick pass already gathered and synthesized.

Then STOP.
