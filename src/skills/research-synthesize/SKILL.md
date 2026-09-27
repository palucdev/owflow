---
name: owflow:research-synthesize
description: Research skill — delegates synthesis and evidence-based reporting to the research-synthesizer agent, producing the synthesis document and the comprehensive research report with per-finding confidence. Closes the research foundation (synthesis-complete) at the boundary with the optional-phase evaluation, continuing with research-scope.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Synthesize — Synthesis & Research Report (synthesis-complete)

Work phase of the research workflow. Delegates pattern synthesis and evidence-based reporting to the research-synthesizer agent (`analysis/synthesis.md` + `outputs/research-report.md`). This is the research-foundation boundary: the Exit Gate absorbs the foundation→optional pause, so its acceptance question IS the gate the old orchestrator called the Phase1→2 pause. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-gather` (produces the merged findings), `/owflow:research-scope` (consumes the synthesis for the enablement decision).

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Research brief & plan (`brief-written`, `plan-created`) → `/owflow:research-plan <task-path>`
     - Parallel findings fan (`findings-gathered`) → `/owflow:research-gather <task-path>`
  2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
  3. Hint: `Run /owflow:research <question> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill              | Where verified                                                                 | Produced by                          |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------ |
| State file exists                    | `<task-path>/orchestrator-state.yml`                                           | `/owflow:research <question>` or quick bootstrap |
| Findings exist                       | `findings-gathered` in `completed_phases` + `analysis/findings/` has per-category files | `/owflow:research-gather <task-path>` (or quick mode's condensed gather) |
| Research question recorded           | `research_context.research_question` non-null in state                          | `/owflow:research-plan <task-path>`   |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `synthesis-complete`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Content check — findings present**: the per-category files under `analysis/findings/` must exist (artifacts before state — drop the `findings-gathered` entry and route back to `/owflow:research-gather <task-path>` when they do not).
3. **Skip/resume**: if `synthesis-complete` is in `completed_phases`, validate `analysis/synthesis.md` AND `outputs/research-report.md` exist; missing → re-run below; both present → report existing synthesis + report summaries and route to the Exit Gate.

## Execute (delegated synthesis)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

> **ANTI-PATTERN — never write synthesis.md or research-report.md yourself. "The findings are few" is NOT a reason to skip delegation. (Quick mode is the ONLY exception — research-plan's quick pass synthesizes inline and skips this section.)**

1. **INVOKE NOW**: Task tool - `research-synthesizer` subagent (never the Skill tool — this is an agent). Pass (Pattern 7 — accumulated context): task_path, findings_directory_path, research_question, research_type, methodology (from state).

**Synthesizer produces**:

- Pattern analysis and cross-references → `analysis/synthesis.md`
- Comprehensive research report answering research question → `outputs/research-report.md`
- Confidence levels for each finding
- Documented gaps and uncertainties

> **SELF-CHECK on both artifacts**: after the Task tool returns, verify `analysis/synthesis.md` AND `outputs/research-report.md` exist (synthesis documents gaps; report carries confidence per finding). If missing: **STOP. Re-invoke the research-synthesizer with corrected context.** If the second attempt also fails, use `question` to report the failure and ask whether to retry or continue without.

### Post-synthesis decision re-cap (direct, condensable)

The synthesizer's key outcomes are surfaced to the user here before the Exit Gate (decisions from subagents must go to the user — never silently skipped): overall `confidence_level`, top patterns, documented gaps. Extract a 1-2 sentence summary into `phase_summaries.synthesize`.

### Close (`synthesis-complete`)

1. **State write**: append `synthesis-complete` to `completed_phases`; update `research_context.confidence_level`, `phase_summaries.synthesize`; set `research_outputs.synthesis` and `research_outputs.research_report`; bump `orchestrator.updated`. On failure: append `synthesis-complete` to `failed_phases`, increment `auto_fix_attempts["synthesis-complete"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`synthesis-complete`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the step fails or its retries are abandoned, do NOT append to `completed_phases`; instead append the step's slug to `orchestrator.failed_phases` and increment `auto_fix_attempts["synthesis-complete"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                              | Max Attempts | Strategy                              |
| --------------------------------- | ------------ | ------------------------------------- |
| Synthesize (`synthesis-complete`) | 2            | Request targeted re-gathering for gaps |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH SYNTHESIZE COMPLETE — <research question>

**Type** — [research type]
**Confidence** — [confidence level from state]
**Key patterns** — [2-3 one-line pattern highlights from synthesis]
**Gaps** — [documented gaps and uncertainties, 1 line]

**Artifacts**

- `analysis/synthesis.md`
- `outputs/research-report.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — synthesis and report are good; continue.
- **Adjust** — re-run the affected part with the user's corrections (targeted re-gathering for gaps, then re-synthesize), update state and artifacts, re-present the results box.
- **Discuss** — walk through specific findings or confidence levels in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-synthesize <task-path>`) and end.

### Next steps (after Accept)

Research foundation complete (initialized, planned, gathered, synthesized). Continue to optional-phase evaluation?

- `→ /owflow:research-scope <task-path>` — `required` next: evaluates brainstorming and design value and writes both enablement flags (`options.brainstorming_enabled`, `options.design_enabled`). Remaining after: optional chain (brainstorm → converge, design) → finalize. If the foundation alone was the goal, stop here — the task stays resumable.

Then STOP.
