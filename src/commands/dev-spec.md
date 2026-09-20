---
name: owflow:dev-spec
description: Development — requirements gathering, specification creation & audit
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-spec skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "dev-spec"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow phase by using /owflow:dev-spec.
Invoke the skill now and let it execute the phase, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the development workflow. See `skills/dev-spec/SKILL.md` for complete phase documentation.

Entry points:

- `/owflow:development <description>` — start a new development task (handoff mode)
- `/owflow:goal-development <description>` — run all phases in one loop (orchestrated mode)
