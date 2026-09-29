---
name: owflow:research-finalize
description: Research skill — terminal step. Inventories all research outputs (the research report always, brainstorm and design artifacts when they exist), presents the workflow results, and gets your confirmation that the research is correct. Marks the task complete.
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-finalize skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-finalize"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-finalize.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Terminal step of the research workflow. Inventory of outputs, results box, confirmation; then assisted mode suggests development handoff. See `skills/research-finalize/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
