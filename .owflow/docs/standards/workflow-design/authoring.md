## Skill, Agent, and Command Authoring

### SKILL.md Frontmatter and Naming Contract
Every SKILL.md declares `name` (always `owflow:`-prefixed), `description`, and `user-invocable`; user-facing skills add `argument-hint`, internal engines set `user-invocable: false`. The `owflow:` prefix is deliberate (OpenCode does not auto-namespace plugin skills) — never rename skills to match folder names.

### Agent Frontmatter Contract
Every agent declares `name`, `description`, `mode: subagent`, and `hidden: true`; use `model: inherit` and include a display color. Agents are hidden from users and model selection is inherited.

### Thin Command Wrappers over Skills
Slash commands are thin wrappers: user-facing guidance lives in commands, orchestration logic lives in SKILL.md. Synthesized wrappers hold no workflow logic; maintained commands (`work`, `reviews-*`) own only routing/argument logic. Edit the source file — never duplicate content.

### Anti-Duplication and Single Source of Truth
If technical details exist in a SKILL.md, reference them instead of restating them in AGENTS.md or commands. Orchestration logic lives in SKILL.md. Never restate skill purposes in AGENTS.md, never restate agent purposes (agents/*.md is the source of truth), and keep commands free of "About this workflow" sections.

### Documentation Content Length Targets
Respect target lengths: skill descriptions in AGENTS.md 5-15 lines; command descriptions 3-8 lines; orchestrator sections 20-30 lines; reference files under 1,000 lines; agent files 300-450 lines; individual standards sections 1-10 lines excluding code. Aim for under ~3,000 lines total per skill across references.

### Reference Files Guide, Not Implement
Reference files provide concepts and decision frameworks (WHAT/WHEN/WHY). They must not contain complete function implementations, production-ready code over 10 lines, extensive pseudocode, or framework-specific boilerplate. Keep code examples under 10 lines and conceptual; trust the agent to reason.

### Reference File Placement
Skill-specific reference material lives in `.owflow/docs`-adjacent `references/` subdirectories with kebab-case filenames (e.g., `skills/<name>/references/<topic>.md`); cross-cutting orchestration references live centrally in `orchestrator-framework/references/` and are linked by relative path.

### Agent Documents Use HR-Separated Sections
Agent markdown bodies separate sections with `---` horizontal rules and reuse a consistent heading vocabulary (Purpose, Workflow, Success Criteria, Input Requirements, Output, Core Philosophy, Integration), ending with a structured YAML result block returned to the orchestrator.

### Structured Documentation for Workflows and Steps
Document workflows and command families structurally, not as prose blocks: nested lists with workflows as outer items and steps as inner items; tables with dedicated columns (workflow, step slug, routing, template/artifact); and separate sections or diagram boxes per workflow family and step, distinguishing full and quick paths.
