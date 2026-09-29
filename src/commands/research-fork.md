---
name: owflow:research-fork
description: Utility command for the research workflow — fork an existing research task by copying its directory into a new task that diverges at a chosen completed step (the copied state is trimmed so the fork continues from that step onwards; the source stays untouched).
argument-hint: "<task-path-or-identifier> [--from=<slug>] [--name=\"...\"]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-fork skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-fork"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-fork.
Invoke the skill now and let it copy the task, update orchestrator state,
and present the fork summary.

---

## About This Workflow

Utility skill of the research workflow — NOT a pipeline step. Copies a research task directory wholesale into a new task that diverges from the previous run at a chosen fork point (`--from=<slug>`); the copied state is trimmed to continue from the fork point onwards. See `skills/research-fork/SKILL.md` for complete documentation.

Related entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
- After forking: `/owflow:research --from=<next-slug> <fork-path>` resumes the fork at the first step after the fork point.
