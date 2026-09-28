---
name: owflow:research-fork
description: Research utility — forks a research task by copying its directory to a NEW task that diverges from the previous run at a chosen completed step (fork point). Steps past the fork point are dropped (state fields reset, artifacts not copied); everything up to it is kept verbatim. The source task is never modified.
argument-hint: "<task-path-or-identifier> [--from=<slug>] [--name=\"...\"]"
user-invocable: true
---

# Research Fork — Task Divergence Copy (utility, no phases)

Utility skill for the research workflow. Copies an existing research task directory (`.owflow/tasks/research/<name>`) into a new task so it can **diverge from the previously run one** — e.g. re-run synthesis or the optional chain (brainstorm → converge → design) with different choices while the original stays intact.

The fork keeps everything up to the **fork point** (a completed step slug, default: the latest completed reviewable step `synthesis-complete` unless `--from` says otherwise) verbatim — kept steps' state fields AND artifacts. Steps **after** the fork point are DROPPED in the fork: their `completed_phases` slugs removed, their owned state fields reset to template values, and their owned artifacts NOT copied (`_archive`-less exclusion at copy time — the source keeps the full audit trail). The fork then continues at full fidelity from the fork point with every research subskill.

Copy mechanics live in the deterministic `fork_task` tool (delegation anti-pattern does not apply — this is a file-copy utility, NOT research work; never perform the copy with bash `cp` yourself). State lives in `orchestrator-state.yml` — this skill reads source state on entry; the tool writes the forked state.

This is NOT a pipeline step: it creates a task, stops at its Exit Gate, and never chains into other skills. Fork anytime — including on `task.status: completed` tasks (research-completed is reset inside the fork).

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/research/` (e.g., `2026-09-26-my-research`); resolve to its path.
- If the argument is **missing** → prompt via `question` (path or identifier), then re-route. If it does **not exist** or matches **no identifier** → print:

```
BLOCKED — no research task found at <arg>.

Quick way out:
  /owflow:research-fork <task-path-or-identifier> [--from=<slug>] [--name="<short name>"]

Available research tasks:
<list directory names under .owflow/tasks/research/, one per line, if any>
```

then STOP (never guess or auto-pick a task). For a fresh research question instead: `/owflow:research <question>`.

### Prerequisites

| Required for this skill | Where verified                                             | Produced by                                    |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                       | `/owflow:research <question>` or `/owflow:research-quick` |
| Forkable research       | `synthesis-complete` in `completed_phases`                  | `/owflow:research-synthesize <task-path>`      |

1. **Read `orchestrator-state.yml`** from the task path. Missing / unreadable → print the blocked block (as above, plus quality gate: forkable research needs `synthesis-complete` — run `/owflow:research-plan <task-path>`, then `/owflow:research-gather <task-path>`, then `/owflow:research-synthesize <task-path>` first) and STOP.

## Fork point (decision, interactive per gate contract)

Derive the candidate fork points from the source state: every slug in `completed_phases` (state is the truth — re-read it, don't trust memory), **excluding `research-completed`** (nothing diverges after completion).

- `--from=<slug>` given → validate it against `completed_phases` (minus `research-completed`) — mismatch → print:

```
BLOCKED — <slug> is not a completed fork point of <task-name>.

Completed steps: <comma-separated slugs from completed_phases, minus research-completed>
Valid fork points are completed step slugs only. Re-run:
  /owflow:research-fork <task-path> --from=<step-slug> [--name="..."]
```

then STOP. Never fall through to the question.

- `--from` missing → `question` — "Where should the fork diverge?" — with each completed slug (minus `research-completed`) as an option (mark `synthesis-complete` "(Recommended)" by default; a slug is only recommended as the latest kept step when the user says the fork should plant its own feet — see the modelling note), each option's description = what the fork keeps ("keeps up to <slug>; drops <downstream slugs>"). WAIT.

## Name (prompt, agent-derived slug)

- `--name="..."` given → the fork name source is that string.
- `--name` missing → `question` — "Short descriptive name for the fork?" (free-form; WAIT).

**Derive the slug yourself** (you are the LLM; no code derives names): from the name source, extract 3-5 key words (Task Name Generation, [Orchestrator Patterns §5](../orchestrator-framework/references/orchestrator-patterns.md)) → lowercase kebab-case, 3-5 words of `[a-z0-9]`, no date prefix. Example: "compare caching strategies" → `compare-caching-strategies`. The final directory is `YYYY-MM-DD-<slug>` (fork execution date).

If the fork_name check reports `NAME_TAKEN`, suggest a 1-word variation and re-ask via `question`. If it reports `INVALID_NAME`, fix the slug (pattern + message tell you what broke) and retry the same source name without re-prompting unless the fix needs more than casing/spacing.

## Execute (utility pass — tool does the copy)

1. Call the `fork_task` tool with:
   - `taskRoot`: `.owflow/tasks`
   - `source`: the resolved task path (or identifier)
   - `slug`: your derived slug
   - `from`: the chosen fork point slug
2. **Tool-agnostic failure handling** — any tool output starting with `INVALID_SOURCE`, `UNKNOWN_STEP`, `NAME_TAKEN`, or `INVALID_NAME` → fix per the output's Hint (re-ask name on `NAME_TAKEN`/`INVALID_NAME`; re-derive fork point on the rest) and re-call the tool. Any other failure → print it and STOP.
3. **Validate the forked state** — run the `verify_template` tool on the FORK's `orchestrator-state.yml` (`filePath: <fork-path>/orchestrator-state.yml`, `templateName: orchestrator-state-research.yml`) — belt-and-braces over the tool's own structural check. Any report → fix per the hint, re-run.
4. **Present the fork summary**:

```
Fork created:            <fork-path>
Forked from:             <source-name> (task untouched)
Fork point:              <slug>
Kept (state + artifacts): <kept slugs>
Dropped (reset + not copied): <dropped slugs or 'none'>
Next resume slug:        <first dropped slug, else none — fork is terminal-complete>
```

## Fork contract reference (what the tool does)

| Dropped slug            | State fields reset                                                                                                     | Artifacts NOT copied                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `plan-created`           | `research_context.methodology`, `.sources`, `.phase_summaries.plan`                                                     | `planning/research-plan.md`, `planning/sources.md` |
| `findings-gathered`      | `research_context.gathering_strategy.{categories,count,source}`, `research_outputs.findings_directory`, `.phase_summaries.gather` | `analysis/findings/` (whole dir)            |
| `synthesis-complete`     | `research_context.confidence_level`, `.phase_summaries.synthesize`, `research_outputs.synthesis`, `.research_report`     | `analysis/synthesis.md`, `outputs/research-report.md` |
| `alternatives-generated` | `.phase_summaries.brainstorm`, `research_outputs.solution_exploration`                                                  | `outputs/solution-exploration.md`             |
| `approaches-chosen`      | `research_context.phase_summaries.converge {summary, decision_areas → [], deferred_ideas}` — no orphan plan summaries    | — (state-only)                                |
| `design-generated`       | `.phase_summaries.design {summary, architecture_style, decisions_count}`, `research_outputs.{high_level_design,decision_log}` | `outputs/high-level-design.md`, `outputs/decision-log.md` |
| `research-completed`     | (dropped only when past the fork point) task stays `in_progress`                                                        | — (state-only)                                |
| `brief-written`          | never dropped (upstream of the forkable anchor `synthesis-complete`)                                                    | —                                             |

Rewrites in the fork's state (in addition to the resets above): `orchestrator.entry_point: "research-fork"`, `orchestrator.task_path` → fork dir, `task.status: in_progress`, `task_ids` cleared, `failed_phases` cleared, `auto_fix_attempts` zeroed, fresh `created`/`updated`, `task.title` suffixed `(fork of <source-name>)`, and an `orchestrator.options.fork_information` stamp: `{forked_from, fork_point, forked_at, executed_steps}`. `project_doc_paths` and all kept-step data are preserved verbatim.

## Exit Gate

Utility skill: confirm-or-revise only ([Confirm-or-Revise Exception](../orchestrator-framework/references/confirm-or-revise-exception.md)) — no pipeline next-steps, no auto-chaining.

### Results box

```markdown
## ✅ RESEARCH FORK COMPLETE — <fork name>

**Source** — <source-name> (task untouched)
**Fork point** — <fork-point slug>
**Kept steps** — <kept slugs>
**Dropped steps** — <dropped slugs> (state reset; artifacts not copied)
**Fork directory** — `<fork-path>`

**Fork state**

- `orchestrator-state.yml` (entry_point: research-fork, fork_information stamped)
- kept `planning/`, `analysis/`, `outputs/` artifacts up to <fork-point slug>

**Next ▸** `/owflow:research --from=<next-slug> <fork-path>` (resume the fork at the first step after the fork point)
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Confirm** — the fork is good; end the skill (print the Next ▸ command one more time for convenience).
- **Revise** — user specifies what to change (wrong fork point / wrong name): DELETE the fork directory ONLY with explicit user confirmation in that same message (`rm -rf` is destructive-hook protected for non-whitelisted agents — run it only after the user re-confirms), or re-fork under a different name; then re-present the results box.
- **Stop here** — print the resume command (`/owflow:research-fork <task-path>`) and end.

## Integration

- The fork is a normal research task from here on: `/owflow:research <fork-path>` routes it, `/owflow:goal-research <fork-path>` chains it, optional-chain choice gates apply as usual.
- Forking a FORK works (fork_information then shows the new source; lineage chains through `forked_from`).
- Development and migration tasks are NOT forkable — this skill is research-only by design.
