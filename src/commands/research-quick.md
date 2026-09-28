---
name: owflow:research-quick
description: Research skill — the quick lane. Bootstraps a standard research task and fuses brief, plan + sources, gather, and synthesis into one condensed pass — the only place where the planner delegation, the gatherer fan, and the synthesizer delegation are condensable. Produces the same standard artifacts and state as the full lane; continuable by any research subskill at full fidelity.
argument-hint: "[task-path-or-identifier | \"description\"]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-quick skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-quick"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-quick.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-quick/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)

Quick lane:

- `/owflow:research-quick "<description>"` — condensed research task: bootstraps a standard research task and then fuses brief, plan, gather, and synthesis into one pass — continuable with any research subskill
