---
name: owflow:research-design
description: Research skill — conditional optional subskill. Asks design preferences (Part A), delegates high-level architecture design to the solution-designer agent (outputs/high-level-design.md + outputs/decision-log.md), then refines diagrams via the diagrams-mermaid Skill — content-preserving (design-generated). Skips itself when design is disabled.
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-design skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-design"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-design.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-design/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
