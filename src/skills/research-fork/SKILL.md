---
name: owflow:research-fork
description: Research utility — forks a research task by copying its directory wholesale into a NEW task named from the given slug, then trimming the copied state so the fork continues from a chosen completed step (fork point) onwards. The source task is never modified.
argument-hint: "<task-path-or-identifier> [--from=<slug>] [--name=\"...\"]"
user-invocable: true
---

# Research Fork — Task Divergence Copy (utility, no phases)

Utility skill for the research workflow. Copies an existing research task directory (`.owflow/tasks/research/<name>`) **wholesale** into a new task so it can **diverge from the previously run one** — e.g. re-run synthesis or the optional chain (brainstorm → converge → design) with different choices while the original stays intact.

The copy is verbatim — every artifact, including outputs of steps after the fork point (the source keeps them too; the resumed step overwrites its outputs). The fork's `orchestrator-state.yml` is then trimmed: `completed_phases` cut at the **fork point** (a completed step slug, default: `synthesis-complete` unless `--from` says otherwise), so the fork **continues from the point onwards**. The fork then continues at full fidelity from the fork point with every research subskill.

Copy mechanics live in the deterministic `fork_task` tool (delegation anti-pattern does not apply — this is a file-copy utility, NOT research work; never perform the copy with bash `cp` yourself). State lives in `orchestrator-state.yml` — this skill reads source state on entry; the tool writes the forked state.

This is NOT a pipeline step: it creates a task, stops at its Exit Gate, and never chains into other skills. Fork anytime — including on `task.status: completed` tasks (`research-completed` is trimmed from the fork's `completed_phases`).

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
| Forkable research       | at least one completed step in `completed_phases`           | any research subskill                          |

1. **Read `orchestrator-state.yml`** from the task path. Missing / unreadable → print the blocked block (as above, plus quality gate: forkable research needs at least one completed step — run `/owflow:research-plan <task-path>`, then `/owflow:research-gather <task-path>`, then `/owflow:research-synthesize <task-path>` first) and STOP.

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

- `--from` missing → `question` — "Where should the fork diverge?" — with each completed slug (minus `research-completed`) as an option (mark `synthesis-complete` "(Recommended)" by default), each option's description = where the fork resumes ("resumes at the step after <slug>"). WAIT.

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
Copied:                  everything from the source (verbatim)
State trimmed:           completed_phases cut at <slug> — resumes at the step after <slug>
```

## Fork mechanics reference (what the tool does)

1. Copies the whole source task directory recursively into `<taskRoot>/research/YYYY-MM-DD-<slug>/` — all artifacts, verbatim.
2. Rewrites only the copied `orchestrator-state.yml`: `orchestrator.completed_phases` sliced up to and including the fork point, `orchestrator.started_phase: null`, `orchestrator.task_path` → fork dir, `task.status: in_progress`, `task.title` suffixed `(fork of <source-name>)`.
3. Everything else — `entry_point`, `research_context`, `research_outputs`, timestamps — is carried verbatim from the source; the resumed step overwrites its own outputs.

Validation errors surfaced by the tool: `INVALID_NAME` (slug pattern), `INVALID_SOURCE` (no research task directory / no parseable state file), `UNKNOWN_STEP` (fork point not in `completed_phases`, or `research-completed` — nothing diverges after completion), `NAME_TAKEN` (fork directory already exists).

## Exit Gate

Utility skill: confirm-or-revise only ([Confirm-or-Revise Exception](../orchestrator-framework/references/confirm-or-revise-exception.md)) — no pipeline next-steps, no auto-chaining.

### Results box

```markdown
## ✅ RESEARCH FORK COMPLETE — <fork name>

**Source** — <source-name> (task untouched)
**Fork point** — <fork-point slug>
**Copied** — full source directory (verbatim)
**State trim** — completed_phases cut at <fork-point slug>
**Fork directory** — `<fork-path>`

**Fork state**

- `orchestrator-state.yml` (completed_phases trimmed at <fork-point slug>, status in_progress)
- all source artifacts, verbatim

**Next ▸** `/owflow:research --from=<next-slug> <fork-path>` (resume the fork at the first step after the fork point)
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Confirm** — the fork is good; end the skill (print the Next ▸ command one more time for convenience).
- **Revise** — user specifies what to change (wrong fork point / wrong name): DELETE the fork directory ONLY with explicit user confirmation in that same message (`rm -rf` is destructive-hook protected for non-whitelisted agents — run it only after the user re-confirms), or re-fork under a different name; then re-present the results box.
- **Stop here** — print the resume command (`/owflow:research-fork <task-path>`) and end.

## Integration

- The fork is a normal research task from here on: `/owflow:research <fork-path>` routes it, `/owflow:goal-research <fork-path>` chains it, optional-chain choice gates apply as usual.
- Forking a FORK works — the title suffix chains (`(fork of <fork-name>)`).
- Development and migration tasks are NOT forkable — this skill is research-only by design.
