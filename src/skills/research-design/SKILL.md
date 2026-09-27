---
name: owflow:research-design
description: Research skill — conditional optional subskill. Asks design preferences (Part A), delegates high-level architecture design to the solution-designer agent (outputs/high-level-design.md + outputs/decision-log.md), then refines diagrams via the diagrams-mermaid Skill — content-preserving (design-generated). Skips itself when design is disabled.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Design — High-Level Design (design-generated)

Work phase of the research workflow. Creates the high-level architecture design from the selected solution approach — or, when brainstorming was skipped, seeded from the research-report recommendations — as two artifacts (`outputs/high-level-design.md`, `outputs/decision-log.md`), then refines diagrams via the `diagrams-mermaid` Skill. Conditional optional phase — runs only when `options.design_enabled: true` (or convergence already completed, the design-only branch). The design Entry Gate owns the brainstorm-skipped branch explicitly. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-scope` (decided the enablement flags), `/owflow:research-brainstorm` + `/owflow:research-converge` (produce the chosen combination consumed as `selected_approach`), `/owflow:research-finalize` (always next). The design-techniques reference lives in this skill's own folder (`references/design-techniques.md` — lands with the references redistribution step).

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Research brief & plan (`brief-written`, `plan-created`) → `/owflow:research-plan <task-path>`
     - Parallel findings fan (`findings-gathered`) → `/owflow:research-gather <task-path>`
     - Synthesis & research report (`synthesis-complete`) → `/owflow:research-synthesize <task-path>`
     - Optional-phase decision (`options-resolved`) → `/owflow:research-scope <task-path>`
     - Chosen approaches (`approaches-chosen`) → `/owflow:research-brainstorm <task-path>` + `/owflow:research-converge <task-path>` (only when brainstorming ran)
  2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
  3. Hint: `Run /owflow:research <question> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                                                                                                             | Produced by                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`                                                                                                        | `/owflow:research <question>` or the research-plan quick bootstrap |
| Enablement decided      | `options-resolved` in `completed_phases` + `options.design_enabled` non-null                                                                | `/owflow:research-scope <task-path>`                               |
| Design input ready      | brainstorm ran — `approaches-chosen` in `completed_phases`; OR brainstorm skipped — `outputs/research-report.md` exists with recommendations | `/owflow:research-converge <task-path>` (or `/owflow:research-synthesize <task-path>`) |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `design-generated`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Conditional activation (defense-in-depth)**: design runs when `options.design_enabled: true` OR `approaches-chosen` is in `completed_phases`. If BOTH are false/absent — `options.design_enabled: false` AND `approaches-chosen` not in `completed_phases` → print `Design is disabled or undecided — high-level design phase not required.` Then:
   - `null` (enablement never decided) → suggest `→ /owflow:research-scope <task-path>` (single-resolution home for both flags), then STOP.
   - disabled/absent with the chain otherwise complete → nothing to design: suggest `→ /owflow:research-finalize <task-path>` (optional chain exhausted), then STOP.
3. **No-brainstorm branch (design Entry Gate owns it)**: if `options.brainstorming_enabled: false` OR `approaches-chosen` is not in `completed_phases`, this is the design-only branch — brainstorming was skipped, so `selected_approach` is seeded from `outputs/research-report.md` recommendations in Part A. State this explicitly: `Brainstorming was skipped — seeding the design from research-report recommendations.` Validate `outputs/research-report.md` exists; missing → blocked-block route `→ /owflow:research-synthesize <task-path>`, then STOP.
4. **Skip/resume**: if `design-generated` is in `completed_phases`, validate BOTH `outputs/high-level-design.md` AND `outputs/decision-log.md` exist; either missing → re-run Parts B-D below; both present → report the existing design summary and route to the Exit Gate.
5. **Prerequisite check**: `options-resolved` must be in `completed_phases`, plus the design input per the table above (`approaches-chosen` when brainstorm ran; `synthesis-complete` + `outputs/research-report.md` on the design-only branch). If missing → print the blocked block, then STOP:
   - Steps that must be completed first: optional-phase decision (`options-resolved`) → chosen approaches (`approaches-chosen`, only when brainstorming ran).
   - `Run /owflow:research-scope <task-path> first` (or the command for the earliest missing earlier step: `/owflow:research-plan`, `/owflow:research-gather`, `/owflow:research-synthesize`, `/owflow:research-brainstorm`, or `/owflow:research-converge`).
   - If no task exists yet: `Run /owflow:research <question> to start a task from scratch.`

## Execute (Part A direct + Part B delegated + Part C direct + Part D Skill)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

**Read `references/design-techniques.md` NOW using the Read tool** — MADR format, ADR guidance, decision documentation patterns (own-folder reference).

### Part A — Design Direction (direct)

1. Brainstorm ran: read the chosen combination from `phase_summaries.converge.decision_areas` — it becomes `selected_approach`.
2. Brainstorm skipped (branch owned in Entry Gate step 3): read `outputs/research-report.md` recommendations and derive `selected_approach` from them; note the provenance (research-report recommendations, not convergence).
3. `question` — "Any architectural constraints or preferences?" (free-form answer; empty means none). These `design_preferences` ride in the Part B context pass and are kept human-readable in `phase_summaries.design.summary` — the state template has NO dedicated `design_preferences` slot; that omission is deliberate (do NOT invent a template field).

### Part B — Design Generation (subagent)

> **ANTI-PATTERN — do NOT generate C4 architecture diagrams or ADRs inline. "The approach is obvious" is NOT a reason to skip delegation. The solution-designer agent has specialized architecture and MADR documentation capabilities.**

1. **INVOKE NOW**: Task tool - `solution-designer` subagent (never the Skill tool — this is an agent). Pass (Pattern 7 — accumulated context):
   - `task_path`, `synthesis_path` (`analysis/synthesis.md`), `research_report_path` (`outputs/research-report.md`)
   - `solution_exploration_path` (`outputs/solution-exploration.md`) — only when brainstorm ran
   - `selected_approach` (from convergence; on the no-brainstorm branch, seeded from research-report recommendations — list the provenance in the prompt)
   - `design_preferences` (from Part A; omit when the user gave none)
   - Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries`
   - `project_doc_paths` (from state)
   - MUST-contract: the designer writes BOTH `outputs/high-level-design.md` AND `outputs/decision-log.md`
2. > **SELF-CHECK**: After the Task tool returns, verify BOTH `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If either is missing: **STOP. Do NOT proceed to Part D or the Exit Gate.** Re-invoke the designer with corrected context. If a second attempt also fails, use `question` to report the failure and ask whether to retry or skip design.

### Part C — Executive Summary (direct, folded)

Content-preserving fold from the monolith: read `outputs/high-level-design.md` and `outputs/decision-log.md`, then present the executive summary THROUGH the Exit-Gate results box below (architecture style and key components, decision count, key decision highlights 1 line each, integration points with the existing system if applicable) — no separate presentation round.

### Part D — Diagram Refinement (Skill, content-preserving)

1. **INVOKE NOW**: Skill tool - `diagrams-mermaid` to refine visual communication in `outputs/high-level-design.md`.
2. Add diagrams that supplement (NOT replace) existing architecture content:
   - one architecture view (`C4Container` preferred; `C4Component` only if needed),
   - one interaction/state view (`sequenceDiagram` or `flowchart`) for the critical flow.
3. If minimum context for a diagram is missing, record explicit gaps in the document and avoid speculative components/relationships.

> Part C — Executive Summary: content-preserving fold — architecture style, key components, decision count, key highlights, and integration points are presented in the Exit-Gate results box below.

### Close (`design-generated`)

1. **State write**: append `design-generated` to `completed_phases` after the SELF-CHECK passes and Part D completes; update `research_context.phase_summaries.design {summary, architecture_style, decisions_count}` (keep the Part A preferences visible in `summary`); set `research_outputs.high_level_design` AND `research_outputs.decision_log`; bump `orchestrator.updated`. On failure: append `design-generated` to `failed_phases`, increment `auto_fix_attempts["design-generated"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`design-generated`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the designer delegation fails or its retries are abandoned, do NOT append `design-generated` to `completed_phases`; instead append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["design-generated"]`. A user-chosen skip via `question` after repeated failures is a deliberate decision: record it in `phase_summaries.design.summary` — no `completed_phases` entry, no `failed_phases` entry.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                          | Max Attempts | Strategy                                       |
| ----------------------------- | ------------ | ----------------------------------------------- |
| Design (`design-generated`)   | 2            | Re-invoke solution-designer with adjusted context |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH DESIGN COMPLETE — <research question>

**Architecture style** — [style and key components]
**Decisions recorded** — [N architectural decisions in decision-log.md]
**Key highlights** — [1 line per key decision]
**Integration points** — [with the existing system, if applicable]
**Diagrams** — [refined by diagrams-mermaid / gaps recorded]

**Artifacts**

- `outputs/high-level-design.md`
- `outputs/decision-log.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the architecture and decision log are good; continue.
- **Adjust** — re-invoke the designer with the user's corrections (changed constraints or preferences), update state and artifacts, re-present the results box.
- **Discuss** — walk through the architecture style or specific architectural decisions in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-design <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:research-finalize <task-path>` — `required` next: inventories all research outputs (including these design artifacts) and completes the task (`research-completed`). Remaining after: none — development starts from finalize's handoff (`→ /owflow:development <task-path>`).

Then STOP.
