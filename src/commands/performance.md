---
name: performance
description: Orchestrates performance optimization workflows using static code analysis to identify bottlenecks (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks). Accepts optional user-provided profiling data. Reuses standard specification, planning, implementation, and verification phases.
argument-hint: [task description]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the performance skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "performance"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /performance.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Orchestrates performance optimization workflows using static code analysis to identify bottlenecks (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks). Accepts optional user-provided profiling data. Reuses standard specification, planning, implementation, and verification phases.

The skill handles:

- Task directory creation and state management
- Phase execution with interactive gates
- Subagent delegation for specialized work
- Pause/resume capability

See `skills/performance/SKILL.md` for complete workflow documentation.
