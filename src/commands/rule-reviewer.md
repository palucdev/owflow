---
name: rule-reviewer
description: Score an AI rules file on 5 axes and produce concrete actionable fixes
---

CRITICAL INSTRUCTION: You MUST invoke the rule-reviewer skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "rule-reviewer"
prompt: "$ARGUMENTS"

DO NOT:
- Analyze the file before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /rule-reviewer.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Score an AI rules file (AGENTS.md, CLAUDE.md, .cursor/rules/*.mdc, .windsurfrules,
.github/copilot-instructions.md, or any rule-for-AI markdown) on 5 axes and return
concrete actionable fixes. The skill is read-only by default — it produces a scorecard.
The only edit it may apply is a section reorder, and only with explicit user approval.

## Examples

```
/rule-reviewer AGENTS.md
/rule-reviewer .cursor/rules/api.mdc
/rule-reviewer src/api/AGENTS.md
```

See `skills/rule-reviewer/SKILL.md` for complete workflow documentation.
