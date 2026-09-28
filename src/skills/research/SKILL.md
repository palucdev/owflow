---
name: owflow:research
description: Research workflow dispatcher. Initializes/resumes research tasks, derives the next step from state, and hands off to the matching /owflow:research-* subskill. Handles comprehensive research and analysis — technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based artifact outputs (findings documentation). Supports standalone research tasks and embedded research phases feeding development workflows. Use /owflow:goal-research to run all phases in one session.
argument-hint: "[task description | task-path] [--from=<slug>] [--type=<type>]"
user-invocable: true
---

# Research Dispatcher

Entry point for research tasks in **assisted mode**: initialize (or resume) the task, derive the next pending step from `orchestrator-state.yml`, print the matching subskill command, and STOP. Each `/owflow:research-*` subskill runs its steps with fresh context — the explicit invocation IS the step gate.

Research state uses descriptive step slugs in `completed_phases` / `failed_phases` / `auto_fix_attempts` (NOT phase numbers): `brief-written`, `plan-created`, `findings-gathered`, `synthesis-complete`, `alternatives-generated`, `approaches-chosen`, `design-generated`, `research-completed`. The routing table below maps slugs to subskills.

For the all-in-one loop with in-session `question` gates, use `/owflow:goal-research`.

Gates follow the shared contract in the [Gate Contract](../orchestrator-framework/references/gate-contract.md), with the [dispatcher exception](../orchestrator-framework/references/gate-contract.md).

## Entry Gate

**BEFORE deriving the handoff, complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference files NOW using the Read tool:**

1. The [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) governs this skill.
2. The [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) bound what subskills delegate.
3. The [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md) define state schema, initialization, and context passing.

### Step 2: Resolve the Argument

**If the argument is a task path or identifier** (a directory, or a directory name under `.owflow/tasks/research/`) → **resume mode**:

1. Read `orchestrator-state.yml`; validate expected artifacts for `completed_phases` (remove entries whose artifacts are missing)
2. Find resume point: first step slug NOT in `completed_phases`; `--from=<slug>` overrides (validate its prerequisites exist, else use `question`)
3. Missing state file → print: `No research task found at <path>. Run /owflow:research <question> to start from scratch.` and STOP

**If the argument is a research question description** (any other free text) → new task.

**If nothing is provided** → ask via `question`: "What is your research question?" (free-form answer), then WAIT. Never guess or auto-pick a task.

### Step 3: Initialize (new task)

**New task** (research question argument):

1. **Create Task Directory**: `.owflow/tasks/research/YYYY-MM-DD-task-name/` (3-5 kebab-case words from the question)
2. **Initialize State**: create `orchestrator-state.yml` from the research template — `task.title` / `task.description` from the question, `task.status: in_progress`, `orchestrator.task_path`, `orchestrator.entry_point: "research"` (template/bootstrap mechanic)
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-research.yml`.
3. **Create Task Items**: use `TaskCreate` for the research steps (one item per subskill handoff), then set the execution order with `TaskUpdate addBlockedBy` (plan → gather → synthesize → optional chain (user choice) → finalize). On resume, refresh the already-evidenced items instead of re-creating them.
4. **Command flags**: `--type=TYPE` → `research_context.research_type`. Subskills read it from there.

**Output**:

```
🚀 Research Dispatcher

Task: [research question]
Directory: [task-path]
Next step: [step name]
```

---

## When to Use

Use when:

- Need comprehensive research on a topic
- Exploring codebase patterns or architecture
- Gathering requirements or best practices
- Want systematic evidence-based answers
- Research will feed into development workflows

**DO NOT use for**: Development tasks, bug fixes, performance optimization.

---

## Core Principles

1. **Evidence-Based**: Every finding must have source citation
2. **Systematic**: Follow structured methodology for consistent results
3. **Multi-Source**: Gather from codebase, docs, config, external sources
4. **Synthesized**: Cross-reference findings, identify patterns
5. **Actionable**: Produce outputs that enable next steps

---

## Routing Table (completed_phases → next subskill)

Derive the FIRST step slug not in `completed_phases`, then print the matching command:

| Next step (slug)                                              | Condition (from state)                                                                                          | Handoff command                          | Produces                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Brief + plan (`brief-written`, `plan-created`)                 | Always (new task or partial foundation)                                                                          | `/owflow:research-plan <task-path>`      | `planning/research-brief.md`, `research-plan.md`, `sources.md` |
| Gather (`findings-gathered`)                                  | `plan-created` completed (gather parses `## Gathering Strategy`, or falls back to 4 default categories)           | `/owflow:research-gather <task-path>`    | `analysis/findings/*.md`                                    |
| Synthesize (`synthesis-complete`)                             | `findings-gathered` completed                                                                                    | `/owflow:research-synthesize <task-path>` | `analysis/synthesis.md`, `outputs/research-report.md`       |
| Optional chain (user choice)                                  | `synthesis-complete` completed — ask via `question` whether to brainstorm, design, or finalize; hand off to the chosen subskill | `/owflow:research-brainstorm` / `/owflow:research-design` / `/owflow:research-finalize <task-path>` | user's chain decision |
| Brainstorm (`alternatives-generated`)                         | User chose brainstorming (invoking the skill IS the decision)                                                    | `/owflow:research-brainstorm <task-path>` | `outputs/solution-exploration.md`                           |
| Converge (`approaches-chosen`)                                | `alternatives-generated` completed (brainstorm ran)                                                              | `/owflow:research-converge <task-path>`  | per-area `chosen_approach` in state (`phase_summaries.converge`) |
| Design (`design-generated`)                                   | User chose design — after `approaches-chosen`, or as the design-only branch (seeded from the research report)     | `/owflow:research-design <task-path>`    | `outputs/high-level-design.md`, `outputs/decision-log.md`   |
| Finalization (`research-completed`)                           | Foundation complete + optional chain settled (every step the user chose to run is recorded)                      | `/owflow:research-finalize <task-path>`  | task completed (`task.status: completed`)                   |

The optional chain is the user's choice — there is no enablement flag in state and no separate decision step. When the user invokes `research-brainstorm` or `research-design`, that invocation IS the decision to run it; when they skip to `research-finalize`, the chain is settled as skipped. After `synthesis-complete` the dispatcher asks which way to go (brainstorm → converge → design, design-only, or straight to finalize).

`research-completed` already in `completed_phases` → the task is TERMINAL: no handoff.

This dispatcher never starts or forwards quick runs. An interrupted quick task (`entry_point: "research-quick"`, `synthesis-complete` not yet recorded) resumes at full fidelity for the missing pieces via the matching subskills. To finish that pass condensed, the user runs `/owflow:research-quick <task-path>` directly.

References moved into their owning subskills (read there, not here): `research-methodologies.md` lives in `research-plan/references/`, `brainstorming-techniques.md` in `research-brainstorm/references/`, `design-techniques.md` in `research-design/references/`.

---

## Exit Gate (adapted for dispatch mode)

After deriving the handoff, present the results box, ask how to proceed, then hand off accordingly (see the [dispatcher exception](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the subskill.

### Results box

```markdown
## ✅ RESEARCH TASK READY — <task name>

**Task** — [research question]
**Directory** — `<task-path>`
**Next step** — [step name]
[Resume note: completed steps / fresh task]

**Next ▸** `/owflow:research-<subskill> <task-path>`
```

### Acceptance question

Use `question` — "Task ready. How would you like to proceed?" with options:

- **Hand off to /owflow:research-<subskill>** — the user invokes the suggested command (dispatcher copies it to chat for convenience). Execution starts in a fresh context.
- **Switch to autonomous mode** — illustrate with `/owflow:goal-research <task-path>` to run remaining steps in one session with gates.
- **Adjust** — task set-up is wrong (wrong flags, wrong question, wrong task); re-run the affected initialization step, re-present the results box.
- **Stop here** — print the resume command (`/owflow:research <task-path>`) and end.

### Handoff message

On Accept (hand off choice), print, then STOP:

```
✓ Research task ready at <task-path>

Next step:
  → /owflow:research-<subskill> <task-path>

Other options:
  /owflow:goal-research <task-path>   — run remaining steps in one loop
  /owflow:research --from=<slug> <task-path>   — jump to a specific step
```

---

## Task Structure

```
.owflow/tasks/research/YYYY-MM-DD-research-name/
├── orchestrator-state.yml
├── planning/
│   ├── research-brief.md           # research-plan (brief step)
│   ├── research-plan.md            # research-plan (plan step)
│   └── sources.md                  # research-plan (plan step)
├── analysis/
│   ├── findings/
│   │   ├── codebase-*.md           # research-gather (per category)
│   │   ├── docs-*.md               # research-gather
│   │   ├── config-*.md             # research-gather
│   │   ├── external-*.md           # research-gather
│   │   └── [custom-category]-*.md  # research-gather (dynamic categories)
│   └── synthesis.md                # research-synthesize (reasoning log)
├── outputs/
│   ├── research-report.md          # research-synthesize (main deliverable)
│   ├── solution-exploration.md     # research-brainstorm (conditional)
│   ├── high-level-design.md        # research-design (conditional)
│   └── decision-log.md             # research-design (conditional)
```

---

## Research Types

| Type             | Keywords                                 | Focus                       | Typical Outputs                   |
| ---------------- | ---------------------------------------- | --------------------------- | --------------------------------- |
| **Technical**    | "how does", "where is", "implementation" | Codebase analysis           | Knowledge base, architecture docs |
| **Requirements** | "what are requirements", "user needs"    | User/business needs         | Specifications, requirements doc  |
| **Literature**   | "best practices", "industry standards"   | External research           | Recommendations, comparisons      |
| **Mixed**        | Multiple keywords, broad questions       | Comprehensive investigation | All output types                  |

---

## Integration with Other Workflows

### As Standalone Research

**Command**: `/owflow:research [research-question | task-path]` — the dispatcher hands off step by step; `/owflow:goal-research <task-path>` runs the complete workflow in one session with interactive gates.

### As Embedded Research Phase (documentation only — no wiring)

> This is documentation for parent-orchestrator authors, NOT an execution path of this dispatcher: nothing here auto-invokes a parent, and no research subskill chains into development or migration steps.

In the split family, a parent orchestrator (development, migration) that needs research sequences the research subskills directly via the Skill tool — plan → gather → synthesize → the optional chain as chosen by the user — and SKIPS `research-finalize`-style completion: the parent handles next steps and keeps control of the flow. Design artifacts feed the parent's specification phase; the research report is saved in the parent task's `analysis/research/` context per the parent's own state setup.

**Handoff fields the parent reads**: refer to `research_outputs.*` in the template [src/templates/orchestrator-state-research.yml](../../templates/orchestrator-state-research.yml).

Full autonomous research (research as its own goal, every gate honored) = `/owflow:goal-research`. A `--no-exit` flag for embedded runs is deferred — not part of this design.

---

## Auto-Recovery

Retries are owned by each subskill (each `/owflow:research-*` SKILL.md carries its own max attempts and strategy).

---

## Command Flags

| Flag                              | Effect                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `--from=<slug>`                   | Hand off (resume mode) from a specific step slug                                     |
| `--type=<type>`                   | Force the research type classification ("technical \| requirements \| literature \| mixed") |

There is deliberately NO quick entry on this dispatcher — condensed quick starts go through `/owflow:research-quick`, whose artifacts this routing table honors on every row.

---

## Command Integration

Invoked via:

- `/owflow:research [question] [--type=TYPE]` (new)
- `/owflow:research [task-path] [--from=<slug>]` (resume)

Alternative: `/owflow:goal-research <task-path>` — same task lifecycle, all subskills invoked in one session with `question` gates.

Task directory: `.owflow/tasks/research/YYYY-MM-DD-task-name/`
