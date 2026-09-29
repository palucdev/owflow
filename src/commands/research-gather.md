---
name: owflow:research-gather
description: Research skill — reads the plan's Gathering Strategy and launches the parallel information-gatherer agent fan in ONE message, then merges per-category findings. Ends the gathering step of the research workflow (findings-gathered) and continues with research-synthesize.
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-gather skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-gather"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-gather.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-gather/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
