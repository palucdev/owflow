---
name: html-renderer
description: Render a markdown plan, idea, RFC, or design note into a self-contained, share-ready HTML file using the warm editorial visual system. Output is a single .html file with all CSS inlined, written next to the source markdown file.
argument-hint: [path to markdown file]
generated-from-skill: true
---

CRITICAL INSTRUCTION: You MUST invoke the html-renderer skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "html-renderer"
prompt: "$ARGUMENTS"

DO NOT:

- Analyze the task before invoking the skill
- Decide the task is "straightforward" and skip the skill
- Substitute your own approach or workflow
- Execute any part of the workflow yourself

WHY: The user explicitly chose this workflow by using /html-renderer.
Invoke the skill now and let it orchestrate the complete workflow.

---

## About This Skill

Render a markdown plan, idea, RFC, or design note into a self-contained, share-ready HTML file using the warm editorial visual system. Output is a single .html file with all CSS inlined, written next to the source markdown file.

The skill handles:

- Markdown parsing and semantic HTML generation
- Design system application with warm editorial styling
- Mermaid diagram rendering via CDN (when present)
- Self-contained output with inlined CSS

See `skills/html-renderer/SKILL.md` for complete documentation.
