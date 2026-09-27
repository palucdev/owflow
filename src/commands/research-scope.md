---
name: owflow:research-scope
description: Research skill — the optional-phase decision. Evaluates brainstorming value and design value independently from the synthesis evidence, auto-resolves the --brainstorm/--no-brainstorm and --design/--no-design flags, asks at most two recommendation questions, and writes both enablement flags together in state (options-resolved). No delegation — this is an inline-legal simple decision.
argument-hint: "[task-path-or-identifier] [--brainstorm|--no-brainstorm] [--design|--no-design]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:research-scope skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "research-scope"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow step by using /owflow:research-scope.
Invoke the skill now and let it execute the step, update orchestrator state,
and present results with next-step suggestions.

---

## About This Workflow

Part of the research workflow. See `skills/research-scope/SKILL.md` for complete step documentation.

Entry points:

- `/owflow:research <description | task-path>` — start or resume a research task (assisted mode)
- `/owflow:goal-research <description>` — run all steps in one loop (orchestrated mode)
