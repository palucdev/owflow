---
name: quick-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation
argument-hint: "[bug description]"
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the quick-bugfix skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "quick-bugfix"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /quick-bugfix.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Quick bug fix with TDD red/green gates and complexity escalation

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/quick-bugfix/SKILL.md` for complete workflow documentation.
