---
name: owflow:goal-development
description: Full orchestrated development wrapper — runs ALL development phases in one session with question gates between subskills
argument-hint: "[task description | task-path]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:goal-development skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "goal-development"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose the orchestrated loop by using /owflow:goal-development.
Invoke the skill now and let it sequence all dev-* subskills with gates between them.

---

## About This Workflow

Autonomous mode for the development workflow: initializes the task, then invokes every required
dev-* subskill in sequence (analyze → tdd-red → spec → plan → implement → verify → finalize),
pausing at question gates. Shares orchestrator state with assisted mode.

See `skills/goal-development/SKILL.md` for the loop rules and
`skills/development/SKILL.md` for the dispatcher alternative.
