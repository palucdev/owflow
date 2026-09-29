---
name: owflow:research-fork
description: Research utility — forks a research task by copying its directory wholesale into a NEW task, then trimming the copied state so the fork continues from a chosen completed step (fork point) onwards. Passing only the task path is enough — the skill orients on the source research, then asks the user (with suggestions) for the fork's intent, fork point, and name. The source task is never modified.
argument-hint: "<task-path-or-identifier> [\"what this fork should explore\"] [--from=<slug>] [--name=\"...\"]"
user-invocable: true
---

# Research Fork — Task Divergence Copy (utility, no phases)

Utility skill for the research workflow. Copies an existing research task directory (`.owflow/tasks/research/<name>`) **wholesale** into a new task so it can **diverge from the previously run one** — e.g. re-run synthesis or the optional chain (brainstorm → converge → design) with different choices while the original stays intact.

The copy is verbatim — every artifact, including outputs of steps after the fork point (the source keeps them too; the resumed step overwrites its outputs). The fork's `orchestrator-state.yml` is then trimmed: `completed_phases` cut at the **fork point** (a completed step slug), so the fork **continues from the point onwards**. The fork then continues at full fidelity from the fork point with every research subskill.

**The task path is the only required input.** A bare `/owflow:research-fork <task-path>` is answered by a short guided setup: the skill reads the source research, then asks up to three questions — intent, fork point, name — each pre-filled with suggestions drawn from that research, and confirms the resulting plan before copying. Every question is skipped when its input is already supplied: a quoted description answers the intent question, `--from=<slug>` the fork point, `--name="..."` the name. Nothing is ever guessed silently — suggestions are proposals, the user answers.

Copy mechanics live in the deterministic `fork_task` tool (delegation anti-pattern does not apply — this is a file-copy utility, NOT research work; never perform the copy with bash `cp` yourself). State lives in `orchestrator-state.yml` — this skill reads source state on entry; the tool writes the forked state.

This is NOT a pipeline step: it creates a task, stops at its Exit Gate, and never chains into other skills. Fork anytime — including on `task.status: completed` tasks (`research-completed` is trimmed from the fork's `completed_phases`).

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- Any remaining free text in the argument is the **intent description** (see Guided setup Q1). It never participates in path resolution.
- If no path/identifier is present → `question` — "Which research task should be forked?" — listing the directory names under `.owflow/tasks/research/` as options (free-form path also accepted), then re-route. If the given argument does **not exist** or matches **no identifier** → print:

```
BLOCKED — no research task found at <arg>.

Quick way out:
  /owflow:research-fork <task-path-or-identifier> ["<what this fork should explore>"]

Available research tasks:
<list directory names under .owflow/tasks/research/, one per line, if any>
```

then STOP (never guess or auto-pick a task). For a fresh research question instead: `/owflow:research <question>`.

### Prerequisites

| Required for this skill | Where verified                                             | Produced by                                    |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                       | `/owflow:research <question>` or `/owflow:research-quick` |
| Forkable research       | at least one completed step in `completed_phases`           | any research subskill                          |

1. **Read `orchestrator-state.yml`** from the task path. Missing / unreadable → print the blocked block (as above, plus quality gate: forkable research needs at least one completed step — run `/owflow:research-plan <task-path>`, then `/owflow:research-gather <task-path>`, then `/owflow:research-synthesize <task-path>` first) and STOP.

## Orient (read the source — suggestions depend on it)

The guided setup is only as good as what the agent actually read. Before asking anything, gather just enough of the source to name its angles, its decisions, and its loose ends:

1. From state: `task.title`, `research_context.research_question`, `scope.included` / `.excluded`, `research_context.phase_summaries.*` (especially `converge.decision_areas[].area|chosen_approach` and `converge.deferred_ideas`), `research_context.confidence_level`.
2. From artifacts, when they exist: the conclusions / open questions / limitations sections of `outputs/research-report.md` and `analysis/synthesis.md`, and the alternatives in `outputs/solution-exploration.md`. Read headings and the decision-relevant parts — this is orientation, not a re-run of the research.
3. Build the **fork-point list**: every slug in `completed_phases` (state is the truth — re-read it, don't trust memory), **excluding `research-completed`** (nothing diverges after completion), in pipeline order, each with the human step name from the [dispatcher routing table](../research/SKILL.md#routing-table-completed_phases--next-subskill):

   | Fork point slug            | Step name                    | Re-runs from                          |
   | -------------------------- | ---------------------------- | ------------------------------------- |
   | `brief-written`            | Brief                        | research-plan                         |
   | `plan-created`             | Plan & sources               | research-gather                       |
   | `findings-gathered`        | Findings gathering           | research-synthesize                   |
   | `synthesis-complete`       | Synthesis & research report  | optional chain (brainstorm / design) / finalize |
   | `alternatives-generated`   | Solution alternatives        | research-converge                     |
   | `approaches-chosen`        | Approach convergence         | research-design / finalize            |
   | `design-generated`         | High-level design            | research-finalize                     |

4. `--from=<slug>` given → validate it against that list — mismatch → print:

```
BLOCKED — <slug> is not a completed fork point of <task-name>.

Valid fork points: <comma-separated slugs from completed_phases, minus research-completed>
Valid fork points are completed step slugs only. Re-run:
  /owflow:research-fork <task-path> --from=<step-slug>
```

then STOP. Never fall through to the question.

## Guided setup (ask what the argument did not answer)

Three questions, in this order. **Ask only the unanswered ones** — each input source short-circuits its question. Every question is a `question` call; WAIT for the answer before the next. Ask no question whose answer is already in the argument, and never invent a user's intent silently.

### Q1 — Intent: "What should this fork explore?"

- **Answered by** a quoted description in the argument → use it verbatim, skip the question.
- **Otherwise ask**, with 3-4 divergence angles derived from what Orient read, marked "(Recommended)" on the one you judge most useful, each description naming the evidence it comes from:
  - re-synthesize with a different lens (e.g. another technology, a cost/constraint focus, a different scope) — from the report's open questions or low `confidence_level`
  - explore a deferred idea — from `converge.deferred_ideas`
  - revisit a chosen approach with an alternative — from `converge.decision_areas[].area|chosen_approach` and the alternatives in `solution-exploration.md`
  - narrow or widen the scope — from `scope.included` / `.excluded`
- Free-form answers are welcome and common — do not push the user toward your options.

### Q2 — Fork point: "Where should the fork diverge?"

- **Answered by** `--from` → validated in Orient, skip the question.
- **Otherwise ask**, one option per fork point in pipeline order, each description = what the fork keeps and re-runs: `"keeps up to <slug> (<step name>); re-runs <next-step command>"`, plus `"(drops N later steps)"` when N > 0. Recommend the latest completed step whose re-run matches the intent — `synthesis-complete` when the intent re-thinks the findings, `approaches-chosen` when it re-opens a chosen approach, `design-generated` when it only reshapes the design, `plan-created` / `findings-gathered` when it changes the sources or scope, `brief-written` for a full restart with a different question. Mark that option "(Recommended)"; every other option stays selectable.

### Q3 — Name: "Short descriptive name for the fork?"

- **Answered by** `--name="..."` → that string is the name source, skip the question.
- **Otherwise ask** with 2-3 slug candidates you derived from the intent (recommended first, marked "(Recommended)"); free-form is fine.

**Derive slugs yourself** (you are the LLM; no code derives names): from the name source — the intent text, or the chosen candidate — extract 3-5 key words (Task Name Generation, [Orchestrator Patterns §5](../orchestrator-framework/references/orchestrator-patterns.md)) → lowercase kebab-case, 3-5 words of `[a-z0-9]`, no date prefix. Example: "compare caching strategies" → `compare-caching-strategies`. The final directory is `YYYY-MM-DD-<slug>` (fork execution date).

### Q4 — Plan confirmation (before anything is written)

Skip only when intent, fork point, and name were ALL supplied by the argument (description + `--from` + `--name`) — nothing was left to confirm. Otherwise print the fork plan and ask:

```
Fork plan
  Source:      <source-name> (task untouched)
  Intent:      <one line, from Q1 or the description argument>
  Fork point:  <slug> — <step name>
  Keeps:       <kept slugs> (verbatim)
  Re-runs:     <first step after the fork point>
  New task:    YYYY-MM-DD-<slug>
```

`question` — "Create this fork?" with options: **Create the fork** (Recommended) / **Change something** (user names what — re-open only that question, keep the other answers) / **Cancel** (print the resume command and end without writing anything). On Cancel: nothing has been copied — do not create the directory.

If the fork-name check later reports `NAME_TAKEN`, suggest a 1-word variation and re-ask via `question`. If it reports `INVALID_NAME`, fix the slug (pattern + message tell you what broke) and retry the same source name without re-prompting unless the fix needs more than casing/spacing.

## Execute (utility pass — tool does the copy)

1. Call the `fork_task` tool with:
   - `taskRoot`: `.owflow/tasks`
   - `source`: the resolved task path (or identifier)
   - `slug`: your derived slug
   - `from`: the chosen fork point slug
   - `intent`: the one-line intent (omit the key when the user gave none)
2. **Tool-agnostic failure handling** — any tool output starting with `INVALID_SOURCE`, `UNKNOWN_STEP`, `NAME_TAKEN`, or `INVALID_NAME` → fix per the output's Hint (re-ask name on `NAME_TAKEN`/`INVALID_NAME`; re-derive fork point on the rest) and re-call the tool. Any other failure → print it and STOP.
3. **Validate the forked state** — run the `verify_template` tool on the FORK's `orchestrator-state.yml` (`filePath: <fork-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`) — belt-and-braces over the tool's own structural check. Any report → fix per the hint, re-run.
4. **Present the fork summary**:

```
Fork created:            <fork-path>
Forked from:             <source-name> (task untouched)
Intent:                  <one line, or 'n/a'>
Fork point:              <slug> (<step name>)
Copied:                  everything from the source (verbatim)
State trimmed:           completed_phases cut at <slug> — resumes at the step after <slug>
```

## Fork mechanics reference (what the tool does)

1. Copies the whole source task directory recursively into `<taskRoot>/research/YYYY-MM-DD-<slug>/` — all artifacts, verbatim.
2. Rewrites only the copied `orchestrator-state.yml`: `orchestrator.completed_phases` sliced up to and including the fork point, `orchestrator.started_phase: null`, `orchestrator.entry_point: "research-fork"`, `orchestrator.task_path` → fork dir, `task.status: in_progress`, `task.title` suffixed `(fork of <source-name>)`, and `orchestrator.options.fork_information` stamped `{forked_from, fork_point, forked_at, intent}` (`intent` only when given) — merged into any pre-existing `options`.
3. Everything else — `research_context`, `research_outputs`, timestamps — is carried verbatim from the source; the resumed step overwrites its own outputs.

Validation errors surfaced by the tool: `INVALID_NAME` (slug pattern), `INVALID_SOURCE` (no research task directory / no parseable state file), `UNKNOWN_STEP` (fork point not in `completed_phases`, or `research-completed` — nothing diverges after completion), `NAME_TAKEN` (fork directory already exists).

## Exit Gate

Utility skill: confirm-or-revise only ([Confirm-or-Revise Exception](../orchestrator-framework/references/confirm-or-revise-exception.md)) — no pipeline next-steps, no auto-chaining.

### Results box

```markdown
## ✅ RESEARCH FORK COMPLETE — <fork name>

**Source** — <source-name> (task untouched)
**Intent** — <one line, or n/a>
**Fork point** — <fork-point slug> (<step name>)
**Copied** — full source directory (verbatim)
**State trim** — completed_phases cut at <fork-point slug>
**Fork directory** — `<fork-path>`

**Fork state**

- `orchestrator-state.yml` (completed_phases trimmed at <fork-point slug>, status in_progress, `options.fork_information` stamped)
- all source artifacts, verbatim

**Next ▸** `/owflow:research <fork-path>` (resume the fork; it routes to the first step after the fork point)
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Confirm** — the fork is good; end the skill (print the Next ▸ command one more time for convenience).
- **Revise** — user specifies what to change (wrong fork point / wrong name / wrong intent): DELETE the fork directory ONLY with explicit user confirmation in that same message (`rm -rf` is destructive-hook protected for non-whitelisted agents — run it only after the user re-confirms), or re-fork under a different name; then re-present the results box.
- **Stop here** — print the resume command (`/owflow:research-fork <task-path>`) and end.

## Integration

- The fork is a normal research task from here on: `/owflow:research <fork-path>` routes it, `/owflow:goal-research <fork-path>` chains it, optional-chain choice gates apply as usual.
- Forking a FORK works — the title suffix chains (`(fork of <fork-name>)`) and `options.fork_information.forked_from` records the immediate parent.
- The description argument also matches the dispatcher's convention of free text narrowing scope, so `/owflow:research-fork <task> explore the cost angle` behaves like `/owflow:development <task> Implement only phase 1`.
- Development and migration tasks are NOT forkable — this skill is research-only by design.
