---
name: standards-discover
description: Discover coding standards from project configuration files, code patterns, documentation, and external sources (PRs, CI/CD)
argument-hint: [task description]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the standards-discover skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "standards-discover"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /standards-discover.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Discover coding standards from project configuration files, code patterns, documentation, and external sources (PRs, CI/CD)

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/standards-discover/SKILL.md` for complete workflow documentation.
