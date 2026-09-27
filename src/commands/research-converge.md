---
name: owflow:research-converge
description: Research skill — conditional optional subskill. Presents the brainstorming alternatives for EVERY decision area with identical full detail — one area, one question — records each chosen approach in phase_summaries.converge.decision_areas (approaches-chosen). Skips itself when brainstorming was skipped; never a combined summary-table confirm.
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-converge skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-converge"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-converge.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-converge/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
