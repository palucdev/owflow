---
name: flow-init
description: Initialize AI SDLC framework with intelligent project analysis and documentation generation
argument-hint: [--standards-from=PATH]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the flow-init skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "flow-init"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /flow-init.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Initialize AI SDLC framework with intelligent project analysis and documentation generation

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/flow-init/SKILL.md` for complete workflow documentation.
