---
name: owflow:research-finalize
description: Research skill — terminal step. Inventories all research outputs (research report always; brainstorm/design artifacts conditionally), presents the workflow results box, and gets user confirmation that the research is correct. Marks the task research-completed — the Exit-Gate acceptance here is where the goal-research wrapper's loop ends.
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
