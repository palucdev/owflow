---
name: owflow:development
description: Development workflow dispatcher — initializes/resumes tasks, derives the next phase from state, and hands off to /owflow:dev-* subskills.
argument-hint: [task description]
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:development skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "development"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /owflow:development.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Development workflow **dispatcher** (assisted mode). The skill handles:

- Task initialization/resume and state management (`orchestrator-state.yml`)
- Research context intake, dev-bugfix/quick-lane entry_points, and flag handling
- Deriving the next pending phase from state
- Handing off to the matching `/owflow:dev-*` subskill, then stopping

Run `/owflow:goal-development` instead for autonomous mode (all subskills in one session with gates).

See `skills/development/SKILL.md` for the routing table and `skills/dev-*/SKILL.md` for phase documentation.
