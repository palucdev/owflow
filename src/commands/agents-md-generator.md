---
name: agents-md-generator
description: Generate AGENTS.md onboarding document for AI coding agents
argument-hint: "[directory or file path]"
---

CRITICAL INSTRUCTION: You MUST invoke the agents-md-generator skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "agents-md-generator"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /agents-md-generator.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Workflow

Generates an `AGENTS.md` onboarding document for AI coding agents working in a repository. Inspects the repo (package manifest, README, scripts, lint/test config, layout, commit history) and writes a concise, reference-heavy contributor guide.

The skill handles:

- Repo-level vs directory-level scope detection
- Create path (fresh generation) and Update path (surgical edits)
- Quality guards enforcing length, specificity, and structure
- Parallel discovery via subagents for large repos

See `skills/agents-md-generator/SKILL.md` for complete workflow documentation.
