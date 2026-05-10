---
name: migration
description: Orchestrates the complete migration workflow from current state analysis through implementation to compatibility verification. Handles technology migrations, platform changes, and architecture pattern transitions with adaptive risk assessment, incremental execution, and rollback planning. Use when migrating technologies, platforms, or architecture patterns.
argument-hint: [task description]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the migration skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "migration"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /migration.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Orchestrates the complete migration workflow from current state analysis through implementation to compatibility verification. Handles technology migrations, platform changes, and architecture pattern transitions with adaptive risk assessment, incremental execution, and rollback planning. Use when migrating technologies, platforms, or architecture patterns.

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/migration/SKILL.md` for complete workflow documentation.
