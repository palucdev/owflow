---
name: owflow:research-scope
description: Research skill — the optional-phase decision. Evaluates brainstorming value and design value independently from the synthesis evidence, auto-resolves the --brainstorm/--no-brainstorm and --design/--no-design flags, asks at most two recommendation questions, and writes both enablement flags together in state (options-resolved). No delegation — this is an inline-legal simple decision.
argument-hint: "[task-path-or-identifier] [--brainstorm|--no-brainstorm] [--design|--no-design]"
user-invocable: true
---

# Research Scope — Optional-Phase Decision (options-resolved)

Work phase of the research workflow. Evaluates whether the optional brainstorming and design phases would add value — independently — and records both enablement decisions in state. A state-only step: no new artifacts. This skill is the **resolution home** for both enablement flags. The only later writer is a user-chosen skip after repeated agent failures: `research-brainstorm` / `research-design` may set their own flag to `false` and record the reason. The optional subskills keep routing guards as defense-in-depth. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

Related phases: `/owflow:research-synthesize` (produces the synthesis this evaluation reads), `/owflow:research-brainstorm` + `/owflow:research-converge` + `/owflow:research-design` (the optional chain it resolves), `/owflow:research-finalize` (the terminal step both flags may route to). In quick mode, the foundation artifacts were fused inside `research-plan` — the evaluation reads the same `analysis/synthesis.md` regardless.

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

Flags `--brainstorm`/`--no-brainstorm` and `--design`/`--no-design` pass through to the decision step below (one flag per decision; a contradictory pair is treated as absent and asked instead).

### Prerequisites

| Required for this skill   | Where verified                                                                       | Produced by                                            |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| State file exists         | `<task-path>/orchestrator-state.yml`                                                  | `/owflow:research <question>` or the research-plan quick bootstrap |
| Foundation complete       | `synthesis-complete` in `completed_phases` + `analysis/synthesis.md` exists             | `/owflow:research-synthesize <task-path>` (or quick mode's fused pass) |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `options-resolved`): `question` — create a fresh standard research task starting at this step, or decline → print `No research task found at <path>. Run /owflow:research <question> to start a task from scratch.` and STOP.
2. **Content check — synthesis present**: the evaluation reads `analysis/synthesis.md`. If the file is missing → print the blocked block, then STOP:
   1. Steps that must be completed first: research brief & plan (`brief-written`, `plan-created`) → parallel findings (`findings-gathered`) → synthesis (`synthesis-complete`).
   2. `Run /owflow:research-synthesize <task-path> first.`
3. **Skip/resume**: if `options-resolved` is in `completed_phases`, validate BOTH `options.brainstorming_enabled` and `options.design_enabled` are non-null in state → report the existing decisions and route to the Exit Gate. Both set but the slug missing (a crash between the write and the slug append) → record `options-resolved` immediately and route to the Exit Gate. Any flag still null → treat that decision as unresolved and continue below (CLI flags may resolve it first).

## Execute (direct — inline-legal simple decision)

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) — "simple decisions" (enabling/disabling optional phases) are explicitly inline-legal; this skill asks `question`s and writes state, it never delegates.

### Evaluate & resolve (`options-resolved`, direct)

1. Read the summary from `analysis/synthesis.md` and `research_context.research_type` from state.
2. **Auto-resolve from flags** (a provided flag decides its own decision; no flag → that decision stays open for the question below):
   - `--brainstorm` → `brainstorming_enabled: true`; `--no-brainstorm` → `brainstorming_enabled: false`
   - `--design` → `design_enabled: true`; `--no-design` → `design_enabled: false`
3. **Evaluate brainstorming value** (only when no flag resolved it) based on:
   - Number of viable approaches identified in synthesis (multiple → valuable)
   - Problem novelty (new domain → valuable; well-understood → less so)
   - Whether synthesis identified competing trade-offs (yes → valuable)
4. **Evaluate design value** (only when no flag resolved it) based on:
   - Whether the research suggests architectural decisions (yes → valuable)
   - Research type (requirements/mixed → likely valuable; technical → depends)
   - Whether design artifacts would feed into the development workflow
5. **One question per still-null flag** — put "(Recommended)" on the option the evaluation above actually favors, and list that option first:
   - Brainstorming: `question` — "[Brainstorming recommendation]. Would you like to explore solution alternatives?" — options: "Yes, explore alternatives" / "No, skip brainstorming"
   - Design: `question` — "[Design recommendation]. Would you like to generate a high-level design?" — options: "Yes, generate design" / "No, skip design"

   The two evaluations are independent: the brainstorming answer does not change the design evaluation, and vice versa. If both flags were auto-resolved from CLI flags, both questions are skipped.
6. **Write both flags together — never partial**: the state write happens ONCE, after both decisions resolve; a mid-skill crash never records one flag alone in `options.*` alongside the slug.

### Close (`options-resolved`)

1. **State write**: append `options-resolved` to `completed_phases` — ONLY after BOTH decisions have resolved (auto-resolved or user-answered); write `options.brainstorming_enabled` AND `options.design_enabled` together in that single write; extract the recommendations and outcomes into `phase_summaries.scope`; bump `orchestrator.updated`. On failure: append `options-resolved` to `failed_phases`, increment `auto_fix_attempts["options-resolved"]`. Then re-read state + run `verify_template` (see State Update Convention).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately — as ONE unit**: the enablement decision resolves as a whole; `options.brainstorming_enabled` and `options.design_enabled` are written together in a single state write, and the `options-resolved` slug is appended ONLY once both decisions have resolved (flag-resolved or user-answered). Never batch results of other steps into one end-of-skill write, and never write one flag without the other.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the evaluation fails or a question is dismissed with no usable answer, do NOT append `options-resolved` to `completed_phases`; instead append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["options-resolved"]`. Answering "No" to both questions is a valid resolution (both flags `false` → finalize), not a failure.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                           | Max Attempts | Strategy                                              |
| ------------------------------ | ------------ | ------------------------------------------------------ |
| Decision (`options-resolved`)  | 1            | Re-evaluate recommendation if synthesis unclear        |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ RESEARCH SCOPE COMPLETE — <research question>

**Brainstorming** — [enabled / disabled] ([resolved from flag / user decision])
**Design** — [enabled / disabled] ([resolved from flag / user decision])
**Remaining chain** — [brainstorm → converge → design → finalize / design → finalize / finalize]

**Artifacts**

- none (state-only) — decisions live in `options.*` of `orchestrator-state.yml`
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the enablement decisions are good; continue.
- **Adjust** — re-evaluate with the user's corrections (re-run the affected evaluation and question), update state, re-present the results box.
- **Discuss** — walk through the value assessment (viable approaches, novelty, trade-offs, design feeds) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:research-scope <task-path>`) and end.

### Next steps (after Accept) — the 3-way branch

- `brainstorming_enabled: true` → `→ /owflow:research-brainstorm <task-path>` — `required` next: delegates multi-perspective solution alternatives (`outputs/solution-exploration.md`), then `research-converge` records the per-area decisions (`approaches-chosen`). Remaining after: converge → design (when `design_enabled: true`) → finalize.
- `brainstorming_enabled: false` AND `design_enabled: true` (design-only branch) → `→ /owflow:research-design <task-path>` — `required` next: seeds the design from the research report recommendations (brainstorm skipped) and produces high-level design + decision log. Remaining after: finalize.
- Both disabled → `→ /owflow:research-finalize <task-path>` — `required` next: inventories the research outputs and completes the task (`research-completed`). Remaining after: none.

Then STOP.
