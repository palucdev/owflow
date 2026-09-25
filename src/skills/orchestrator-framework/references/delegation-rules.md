# Delegation Rules

Shared rules for how orchestrators and subskills delegate work. Extracted from `orchestrator-patterns.md` (Section 1) so skills can link to it directly.

---

**Always use Skill/Task tools to delegate. Never execute delegated work inline.**

When a phase requires delegation:

1. Use the **Skill tool** for **skills** — loads SKILL.md instructions into the main agent's context; the main agent executes the skill's instructions and continues with the orchestrator workflow afterward
2. Use the **Task tool** for **subagents/agents** — spawns an isolated subprocess that returns results when complete
3. Wait for completion before continuing

**Skills and agents are NOT interchangeable.** Skills always use Skill tool; agents always use Task tool. Never invoke a skill via Task tool (`subagent_type`) — it will fail with "Agent type not found."

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementation-plan-executor`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners). Subagents cannot spawn other subagents — so these skills must run in the main agent context via Skill tool.

**Companion agent pattern** (e.g., `docs-operator`): Only works for skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. This pattern fails for any skill that needs to spawn subagents.

## Anti-Patterns

| Anti-Pattern                            | Why It's Wrong                              | Correct Approach                                      |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| "I'll analyze the codebase..."          | Bypasses codebase-analyzer skill            | Use `Skill` tool with `codebase-analyzer`             |
| "Let me create the specification..."    | Bypasses specification-creator              | Use `Task` tool with `specification-creator` subagent |
| "Looking at the gaps between..."        | Bypasses gap-analyzer subagent              | Use `Task` tool with `gap-analyzer`                   |
| "I'll implement this by..."             | Bypasses implementation-plan-executor skill | Use `Skill` tool with `implementation-plan-executor`  |
| Reading a SKILL.md then doing the work  | Skill files are instructions FOR skills     | Use Skill tool to invoke                              |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents    | Invoke skill, let IT spawn agents                     |

## When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** — question is direct
2. **State updates** — Reading/writing orchestrator-state.yml
3. **Phase announcements** — Outputting status messages
4. **Simple decisions** — Enabling/disabling optional phases
5. **Finalization** — Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):

- Specification creation → always delegate to `specification-creator` subagent
- Implementation planning → always delegate to `implementation-planner` subagent
- Gap analysis → always delegate to `gap-analyzer` subagent
- Codebase analysis → always delegate to `codebase-analyzer` skill
- Code review → always delegate to `code-reviewer` subagent
- Test execution → always delegate to `test-suite-runner` subagent
- Implementation completeness → always delegate to `implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation.
