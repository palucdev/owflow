---
name: diagrams-mermaid
description: Generate Mermaid diagrams from natural language descriptions. Creates diagrams in markdown format with mermaid code fences. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, user journeys, Gantt charts, pie charts, and C4 diagrams.
argument-hint: [diagram description]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the diagrams-mermaid skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "diagrams-mermaid"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /diagrams-mermaid.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Skill

Generate Mermaid diagrams from natural language descriptions. Creates diagrams in markdown format with mermaid code fences. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, user journeys, Gantt charts, pie charts, and C4 diagrams.

The skill handles:

- Diagram type selection based on description
- Mermaid syntax generation with proper formatting
- Best practices and anti-patterns enforcement
- Output in markdown format with mermaid code fences

See `skills/diagrams-mermaid/SKILL.md` for complete documentation.
