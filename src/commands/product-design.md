---
name: product-design
description: Interactive product/feature design orchestrator. Transforms fuzzy ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Adaptive phases detect design complexity and adjust depth.
argument-hint: [task description]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the product-design skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "product-design"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /product-design.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Interactive product/feature design orchestrator. Transforms fuzzy ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Adaptive phases detect design complexity and adjust depth.

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/product-design/SKILL.md` for complete workflow documentation.
