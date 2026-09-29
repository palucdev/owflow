---
name: owflow:research
description: Research workflow dispatcher. Initializes/resumes research tasks, derives the next step from state, and hands off to the matching /owflow:research-* subskill. Handles comprehensive research and analysis — technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based artifact outputs (findings documentation). Supports standalone research tasks and embedded research phases feeding development workflows.
argument-hint: "[task description | task-path] [--from=<slug>] [--type=<type>]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /owflow:research.
Invoke the skill now and let it dispatch the matching research step.

---

## About This Workflow

Research workflow **dispatcher** (assisted mode). The skill handles:

- Task initialization/resume and state management (`orchestrator-state.yml`)
- Research context intake and `--type` flag handling
- Deriving the next pending step from state (descriptive slugs, NOT phase numbers)
- Handing off to the matching `/owflow:research-*` subskill, then stopping

Run `/owflow:goal-research` instead for autonomous mode (all subskills in one session with gates).

Quick lane: starts only via `/owflow:research-quick "<description>"` — a condensed research task that fuses brief, plan, gather, and synthesis into one pass, continuable by any research subskill.

Forking: `/owflow:research-fork <task-path> ["<what this fork should explore>"] [--from=<slug>]` copies a research task to a new task diverging at a chosen completed step (directory copied verbatim, `completed_phases` trimmed) — original task untouched. A bare task path is enough: the skill asks for the intent, fork point, and name with suggestions taken from that research.

Entry points:

- `/owflow:research <description>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)

Steps (each works on the shared task directory):

- `/owflow:research-plan <description | task-path>` — brief, methodology & plan
- `/owflow:research-gather <task-path>` — parallel findings fan
- `/owflow:research-synthesize <task-path>` — synthesis & research report
- `/owflow:research-brainstorm <task-path>` — solution alternatives (optional, user's choice)
- `/owflow:research-converge <task-path>` — per-area decisions (after brainstorming)
- `/owflow:research-design <task-path>` — high-level design (optional, user's choice)
- `/owflow:research-finalize <task-path>` — completion & handoff

See `skills/research/SKILL.md` for the routing table and `skills/research-*/SKILL.md` for step documentation.
