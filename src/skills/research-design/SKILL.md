---
name: owflow:research-design
description: Research skill — conditional optional subskill. Asks design preferences (Part A), delegates high-level architecture design to the solution-designer agent (outputs/high-level-design.md + outputs/decision-log.md), then refines diagrams via the diagrams-mermaid Skill — content-preserving (design-generated). Skips itself when design is disabled.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Design — High-Level Design (design-generated)

Work phase of the research workflow. Creates the high-level architecture design from the selected solution approach — or, when brainstorming was skipped, seeded from the research-report recommendations — as two artifacts (`outputs/high-level-design.md`, `outputs/decision-log.md`), then refines diagrams via the `diagrams-mermaid` Skill. Conditional optional phase — runs only when `options.design_enabled: true`. The design-only branch (brainstorming skipped) is owned here: `selected_approach` is seeded from the research report. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-scope` (decided the enablement flags), `/owflow:research-brainstorm` + `/owflow:research-converge` (produce the chosen combination consumed as `selected_approach`), `/owflow:research-finalize` (always next). The design-techniques reference lives in this skill's own folder (`references/design-techniques.md`).

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
2. **Prerequisite check**: `options-resolved` must be in `completed_phases` and `options.design_enabled` must be non-null. If missing, or the flag is null → print the blocked block (`→ /owflow:research-scope <task-path>`, or the earliest missing earlier step), then STOP.
3. **Conditional activation**: design runs ONLY when `options.design_enabled: true`. If `false` → print `Design is disabled — high-level design phase not required.` and suggest `→ /owflow:research-finalize <task-path>`, then STOP. Convergence having completed does NOT enable design.
4. **Design input**:
   - `options.brainstorming_enabled: true` and `approaches-chosen` not in `completed_phases` → the brainstorm chain is still pending. Print the blocked block pointing at whichever step is missing — `/owflow:research-brainstorm <task-path>` when `alternatives-generated` is absent, otherwise `/owflow:research-converge <task-path>` — then STOP. Do NOT seed from the research report while brainstorming is still enabled.
   - `options.brainstorming_enabled: true` and `approaches-chosen` in `completed_phases` but `phase_summaries.converge.decision_areas` has no `chosen_approach` → convergence never resolved its areas: `→ /owflow:research-converge <task-path>`, then STOP.
   - `options.brainstorming_enabled: false` → design-only branch. State `Brainstorming was skipped — seeding the design from research-report recommendations.` Validate `outputs/research-report.md` exists; missing → `→ /owflow:research-synthesize <task-path>`, then STOP.
5. **Skip/resume**: if `design-generated` is in `completed_phases`, validate BOTH `outputs/high-level-design.md` AND `outputs/decision-log.md` exist; either missing → re-run Parts B-D below; both present → report the existing design summary and route to the Exit Gate.

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
2. > **SELF-CHECK**: After the Task tool returns, verify BOTH `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If either is missing: **STOP. Do NOT proceed to Part D or the Exit Gate.** Re-invoke the designer with corrected context. If a second attempt also fails, use `question` to report the failure and ask whether to retry or skip design. A skip sets `options.design_enabled: false` (see State Update Convention) — it does not leave the flag true.

### Part C — Executive Summary (direct)

Read `outputs/high-level-design.md` and `outputs/decision-log.md`, then present the executive summary through the Exit-Gate results box below (architecture style and key components, decision count, key decision highlights 1 line each, integration points with the existing system if applicable) — no separate presentation round.

### Part D — Diagram Refinement (Skill, content-preserving)

1. **INVOKE NOW**: Skill tool - `diagrams-mermaid` to refine visual communication in `outputs/high-level-design.md`.
2. Add diagrams that supplement (NOT replace) existing architecture content:
   - one architecture view (`C4Container` preferred; `C4Component` only if needed),
   - one interaction/state view (`sequenceDiagram` or `flowchart`) for the critical flow.
3. If minimum context for a diagram is missing, record explicit gaps in the document and avoid speculative components/relationships.

### Close (`design-generated`)

1. **State write**: append `design-generated` to `completed_phases` after the SELF-CHECK passes and Part D completes; update `research_context.phase_summaries.design {summary, architecture_style, decisions_count}` (keep the Part A preferences visible in `summary`); set `research_outputs.high_level_design` AND `research_outputs.decision_log`; bump `orchestrator.updated`. On failure: append `design-generated` to `failed_phases`, increment `auto_fix_attempts["design-generated"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`design-generated`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the designer delegation fails or its retries are abandoned, do NOT append `design-generated` to `completed_phases`; instead append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["design-generated"]`. A user-chosen skip via `question` after repeated failures is a deliberate decision, not a failure: set `options.design_enabled: false`, record the reason in `phase_summaries.design.summary`, and append neither `design-generated` nor a `failed_phases` entry. Then present the Exit Gate (results box notes the skip; next step is `/owflow:research-finalize <task-path>`). Do NOT leave the flag true — the dispatcher would route back into this skill.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                          | Max Attempts | Strategy                                       |
| ----------------------------- | ------------ | ----------------------------------------------- |
| Design (`design-generated`)   | 2            | Re-invoke solution-designer with adjusted context |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill. A user-chosen skip still uses this Exit Gate; its results box says the step was skipped and why, and the next step is `/owflow:research-finalize <task-path>`.

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
