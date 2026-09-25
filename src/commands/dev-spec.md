---
name: owflow:dev-spec
description: Development — requirements gathering, specification creation & audit. --quick bootstraps a condensed spec-only task when no state file exists.
argument-hint: "[task-path-or-identifier | \"description\"] [--quick]"
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

- `/owflow:development <description>` — start a new development task (assisted mode)
- `/owflow:goal-development <description>` — run all phases in one loop (orchestrated mode)

Quick lane:

- `/owflow:dev-spec --quick "<description>"` — condensed spec-only task: bootstraps a standard development task (state + standards discovery + quick analysis), writes the condensed specification directly on the fly (no specification-creator subagent; diagrams are optional and gated by a question; audit is skipped — `/owflow:reviews-spec-audit` stays available later), then stops — continuable with `/owflow:dev-plan` or any dev-* subskill
