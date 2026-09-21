---
name: owflow:dev-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation — standard dev-task state, continuable by any dev-* subskill
argument-hint: "[bug description | task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-bugfix skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "dev-bugfix"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /owflow:dev-bugfix.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Quick bug fix with TDD red/green gates and complexity escalation. An alternative entry point into the dev-* workflow: bootstraps (or resumes) a standard development task with `orchestrator-state.yml`.

Pass a bug description for a fresh fix, or a task path/identifier (under `.owflow/tasks/development/`) to fix a newly emerging problem on an existing development task.
The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/dev-bugfix/SKILL.md` for complete workflow documentation.
