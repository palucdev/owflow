---
name: owflow:goal-research
description: Full orchestrated research wrapper — runs ALL research steps in one session by invoking every research-* subskill in sequence with question gates between them (equivalent to the classic unified orchestrator for research). Use /owflow:research for the same lifecycle in assisted mode — tasks can mix both modes freely.
argument-hint: "[task description | task-path] [--from=<slug>] [--brainstorm|--no-brainstorm] [--design|--no-design] [--type=<type>]"
---

CRITICAL INSTRUCTION: You MUST invoke the owflow:goal-research skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "goal-research"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose the orchestrated loop by using /owflow:goal-research.
Invoke the skill now and let it sequence all research subskills with gates between them.

---

## About This Workflow

Autonomous mode for research tasks: initializes (or resumes) the task, then invokes every required
research subskill in sequence (plan → gather → synthesize → scope → optional chain → finalize),
pausing at question gates. Shares orchestrator state with assisted mode — tasks can mix both
modes freely (assisted mode is `/owflow:research`).

See `skills/goal-research/SKILL.md` for the loop rules and
`skills/research/SKILL.md` for the dispatcher alternative.
