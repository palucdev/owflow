# Command Namespacing

How commands and skills are named and referenced. Extracted from `orchestrator-patterns.md` (Section 8) so skills can link to it directly.

- Slash commands registered from `src/commands/*.md` use `name: owflow:<command>` in frontmatter; users invoke `/owflow:<command>`.
- **Skill `name:` fields are prefixed too.** Skill-tool invocations (`skill: "owflow:development"`, `skills:` frontmatter preloads, work.md routing) always reference `owflow:`-prefixed skill names.
- Handoff messages, docs, and cross-references always display the prefixed slash command — never the bare skill name — in user-facing text.
