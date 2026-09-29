---
name: owflow:research-synthesize
description: Research skill — delegates synthesis and evidence-based reporting to the research-synthesizer agent, producing the synthesis document and the comprehensive research report with per-finding confidence. Closes the research foundation (synthesis-complete) at the boundary with the optional chain (user choice).
argument-hint: "[task-path-or-identifier]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-synthesize skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-synthesize"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-synthesize.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-synthesize/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
