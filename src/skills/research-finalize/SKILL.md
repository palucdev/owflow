---
name: owflow:research-finalize
description: Research skill — terminal step. Inventories all research outputs (research report always; brainstorm/design artifacts conditionally), presents the workflow results box, and gets user confirmation that the research is correct. Marks the task research-completed — the Exit-Gate acceptance here is where the goal-research wrapper's loop ends.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Research Finalize — Completion & Handoff (research-completed)

Terminal step of the research workflow. Presents research results, confirms correctness with the user, and hands off to development (or ends the workflow). No new files — summarizes existing outputs. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: all research subskills (`/owflow:research-plan` → `/owflow:research-gather` → `/owflow:research-synthesize` → the optional chain as chosen by the user). This is the terminal skill: its Exit-Gate acceptance is where the goal-research wrapper's loop ends, and where assisted mode suggests development.

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

| Required for this skill | Where verified                                                                  | Produced by                                                        |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| State file exists       | `<task-path>/orchestrator-state.yml`                                             | `/owflow:research <question>` or `/owflow:research-quick` |
| Foundation complete     | `synthesis-complete` in `completed_phases` + `outputs/research-report.md` exists | `/owflow:research-synthesize <task-path>`                          |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `research-completed`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Prerequisite check**: `synthesis-complete` must be in `completed_phases` and `outputs/research-report.md` must exist. The optional chain is settled by the user's own choices — invoking `research-brainstorm`/`research-design` is the decision to run them; skipping straight here settles the chain as skipped. If the foundation is missing → print the blocked block for the earliest missing step, then STOP:
   - `Run /owflow:research-plan <task-path> first` (or the command for the earliest missing earlier step: `/owflow:research-gather` or `/owflow:research-synthesize`).
   - If no task exists yet: `Run /owflow:research <question> to start a task from scratch.`
3. **Skip/resume**: if `task.status` is `completed`, report the existing finalization (results box from the inventory below) and STOP (dev-finalize terminal pattern).
4. **Always runs**: this skill always runs — every path (no optional steps / design-only / full brainstorm chain) reaches completion here. The optional phases only affect the inventory and the "Phases run" line.

## Input / Output Artifacts

| Artifact                                       | Normal mode (full lane)                                        | Quick mode (`research-quick`)                                                    |
| ---------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Consumed: `outputs/research-report.md` (always) + conditional design/brainstorm artifacts | inventoried per `research_outputs.*` in state | identical — a quick-pass task brings the same standard artifacts                             |
| Produced: none (state-only)                    | no new files — finalization is an inventory                         | same — after a quick pass this skill completes the task the same way                        |
| State write                                    | `research-completed`; `task.status: completed`                     | same slug and field                                                                    |

## Execute (direct — inline-legal finalization)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) — finalization is inline-legal ("finalization" is a simple, direct step; no agents involved).

### Inventory outputs

1. **Inventory all generated outputs**: `outputs/research-report.md` (always), plus conditional: `outputs/solution-exploration.md`, `outputs/high-level-design.md`, `outputs/decision-log.md` — each conditional artifact is listed only when its `research_outputs` field is set in state (and the file exists).
2. **Results box**:

```markdown
## ✅ RESEARCH COMPLETE — <research question>

**Type** — [research type]
**Confidence** — [confidence level]
**Phases run** — [executed slug list, e.g. brief-written → plan-created → findings-gathered → synthesis-complete → alternatives-generated → approaches-chosen → design-generated]
**Key findings** — [2-3 one-line highlights]
**Decisions** — [count of ADRs, if design ran]

**Artifacts**

- `outputs/research-report.md`
- `outputs/solution-exploration.md` [conditional]
- `outputs/high-level-design.md` [conditional]
- `outputs/decision-log.md` [conditional]
```

### Close (`research-completed`)

1. **State write**: append `research-completed` to `completed_phases` and set `task.status: completed` — ONLY after the results box is presented; do NOT write a `phase_summaries.finalize` slot (the template has no finalize slot — finalization is state-only, and the inventory lives in `research_outputs.*`); bump `orchestrator.updated`. On failure: append `research-completed` to `failed_phases`, increment `auto_fix_attempts["research-completed"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed (`research-completed`) plus that step's fields. Never batch multiple steps into one end-of-skill write. **No `phase_summaries.finalize` write** — the template has no such slot (finalization is state-only; the inventory lives in `research_outputs.*`).
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if finalization fails, do NOT append `research-completed` to `completed_phases`; instead append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["research-completed"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                              | Max Attempts | Strategy      |
| --------------------------------- | ------------ | -------------- |
| Completion (`research-completed`) | 0            | Summary only   |

## Exit Gate

Present results, get user confirmation, then close the workflow (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill. **This acceptance is where the goal-research wrapper's loop ends** (Accept = the wrapper proceeds to its own wrapper Exit Gate; any other option ends the loop with the standard handoff block). In assisted mode, Accept prints the next steps below.

### Results box

The results box from the Inventory outputs step above IS the workflow-level results box — present it here as-is (single box, not two).

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — research is complete; print next steps (below).
- **Adjust** — re-run the affected phase (re-gather → `/owflow:research-gather <task-path>`, re-brainstorm → `/owflow:research-brainstorm <task-path>`, re-design → `/owflow:research-design <task-path>`) with the user's corrections, then re-present the results box.
- **Discuss** — walk through specific findings or decisions in more depth; then re-ask.
- **Fork** — branch instead of re-running here: `/owflow:research-fork <task-path> [--from=<slug>]` copies this task to a new one diverging at a chosen completed step (source untouched).
- **Stop here** — print the resume command (`/owflow:research-finalize <task-path>`) and end.

### Next steps (after Accept)

If design artifacts exist (research report + design → development handoff), suggest starting development in a fresh session:

```
To start development based on this research, clear context first or start a new session, then run:
→ /owflow:development <task-path>
```

Without design artifacts, the research report remains the deliverable — feed it into `/owflow:development <task-path>` the same way when development is ready, or reference it manually.

Then STOP.
