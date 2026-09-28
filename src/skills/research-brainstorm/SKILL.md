---
name: owflow:research-brainstorm
description: Research skill — optional subskill. Delegates multi-perspective solution-alternative generation to the solution-brainstormer agent, producing outputs/solution-exploration.md. Invoking this skill IS the decision to brainstorm — there is no enablement flag.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Brainstorm — Solution Alternatives (alternatives-generated)

Work phase of the research workflow. Delegates divergent solution-alternative generation to the solution-brainstormer agent (`outputs/solution-exploration.md`). Optional phase — runs when the user chooses it: invoking this skill IS the decision to brainstorm (no enablement flag in state). There is no auto-continue into convergence: this skill's Exit Gate and `research-converge`'s Entry Gate make that boundary explicit. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-converge` (consumes the alternatives for per-area decisions). The brainstorming-techniques reference lives in this skill's own folder (`references/brainstorming-techniques.md`).

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Research brief & plan (`brief-written`, `plan-created`) → `/owflow:research-plan <task-path>`
     - Parallel findings fan (`findings-gathered`) → `/owflow:research-gather <task-path>`
     - Synthesis & research report (`synthesis-complete`) → `/owflow:research-synthesize <task-path>`
  2. List available research-task identifiers (directories under `.owflow/tasks/research/`) to resume from, if any.
  3. Hint: `Run /owflow:research <question> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill     | Where verified                                                                            | Produced by                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| State file exists           | `<task-path>/orchestrator-state.yml`                                                       | `/owflow:research <question>` or `/owflow:research-quick` |
| Foundation complete         | `synthesis-complete` in `completed_phases` + `analysis/synthesis.md` AND `outputs/research-report.md` exist | `/owflow:research-synthesize <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `alternatives-generated`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `alternatives-generated` is in `completed_phases`, validate `outputs/solution-exploration.md` exists; missing → re-run below; present → report the existing alternatives summary and route to the Exit Gate.
3. **Prerequisite check**: `synthesis-complete` must be in `completed_phases`. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: synthesis (`synthesis-complete`).
   - `Run /owflow:research-synthesize <task-path> first` (or the command for the earliest missing earlier step: `/owflow:research-plan` or `/owflow:research-gather`).
   - If no task exists yet: `Run /owflow:research <question> to start a task from scratch.`

## Execute (delegated brainstorm)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

**Read `references/brainstorming-techniques.md` NOW using the Read tool** — divergent/convergent thinking techniques, interactive exploration, scope guardrails.

> **ANTI-PATTERN — do NOT generate solution alternatives inline. "The question is simple" is NOT a reason to skip delegation. The solution-brainstormer agent has specialized multi-perspective analysis capabilities.**

1. **INVOKE NOW**: Task tool - `solution-brainstormer` subagent (never the Skill tool — this is an agent). Pass (Pattern 7 — accumulated context):
   - `task_path`, `synthesis_path` (`analysis/synthesis.md`), `research_report_path` (`outputs/research-report.md`)
   - `output_path`: `outputs/solution-exploration.md` — brainstormer MUST write to this exact path
   - Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (foundation slugs)
   - `project_doc_paths` (from state)

2. > **SELF-CHECK**: After the Task tool returns, verify `outputs/solution-exploration.md` exists and contains alternatives. If missing: **STOP. Do NOT proceed to convergence or design.** Re-invoke the brainstormer with corrected context (ensure `output_path` is `outputs/solution-exploration.md`). If a second attempt also fails, use `question` to report the failure and ask whether to retry or skip brainstorming.

3. On a user-chosen skip (via `question` after repeated failures): record the reason in `phase_summaries.brainstorm`. Do not append `alternatives-generated` to `completed_phases` and do not append a `failed_phases` entry (a deliberate decision, not a failure). Then present the Exit Gate: the results box notes the skip, and the next step follows the user's call (`→ /owflow:research-design <task-path>` for the design-only branch, otherwise `→ /owflow:research-finalize <task-path>`).

### Close (`alternatives-generated`)

1. **State write**: append `alternatives-generated` to `completed_phases` after the SELF-CHECK passes; update `phase_summaries.brainstorm`; set `research_outputs.solution_exploration`; bump `orchestrator.updated`. On failure: append `alternatives-generated` to `failed_phases`, increment `auto_fix_attempts["alternatives-generated"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`alternatives-generated`) plus that step's fields. Never batch multiple steps into one end-of-skill write.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the brainstormer delegation fails or its retries are abandoned, do NOT append `alternatives-generated` to `completed_phases`; instead append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["alternatives-generated"]`. A user-chosen skip is not a failure: record the reason in `phase_summaries.brainstorm` (see Execute step 3) instead of writing `failed_phases`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                                | Max Attempts | Strategy                                            |
| ----------------------------------- | ------------ | ---------------------------------------------------- |
| Brainstorm (`alternatives-generated`) | 2          | Re-invoke solution-brainstormer with adjusted context |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill. There is no auto-continue into convergence — converge's Entry Gate re-validates the artifact. A user-chosen skip still uses this Exit Gate; its results box says the step was skipped and why.

### Results box

```markdown
## ✅ RESEARCH BRAINSTORM COMPLETE — <research question>

**Type** — [research type]
**Decision areas** — [N areas surfaced in solution-exploration.md]
**Alternatives** — [total alternatives across areas]

**Artifacts**

- `outputs/solution-exploration.md`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the alternatives are good; continue.
- **Adjust** — re-invoke the brainstormer with the user's corrections (refined scope or emphasis), update state and artifacts, re-present the results box.
- **Discuss** — walk through specific alternatives or a decision area in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-brainstorm <task-path>`) and end.

### Next steps (after Accept)

- Alternatives produced → `→ /owflow:research-converge <task-path>` — `required` next: presents the alternatives per decision area with identical full detail, records each `chosen_approach` in state, and resolves the combination (`approaches-chosen`). Remaining after: design (when the user wants it) → finalize.
- User-chosen skip → `→ /owflow:research-design <task-path>` (design-only branch, seeded from the research report) or `→ /owflow:research-finalize <task-path>`, per the user's call. Do not suggest converge — there are no alternatives to converge on.

Then STOP.
