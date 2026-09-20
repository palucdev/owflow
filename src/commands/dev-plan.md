---
name: owflow:dev-plan
description: Development — break the specification into a grouped implementation plan
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-plan skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "dev-plan"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow phase by using /owflow:dev-plan.
Invoke the skill now and let it execute the phase, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the development workflow. See `skills/dev-plan/SKILL.md` for complete phase documentation.

Entry points:

- `/owflow:development <description>` — start a new development task (handoff mode)
- `/owflow:goal-development <description>` — run all phases in one loop (orchestrated mode)
