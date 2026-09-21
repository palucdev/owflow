# AI SDLC Plugin

This plugin provides AI-powered Software Development Lifecycle (SDLC) capabilities for OpenCode projects.

## Platform: OpenCode

This is the OpenCode plugin. Key platform conventions:

- **Project instructions file**: `AGENTS.md` (this file).
- **Skill invocation rule**: When a skill command is invoked (e.g., `/owflow:development`, `/owflow:flow-init`), you MUST
  invoke it via the `skill` tool as your FIRST action. No exceptions. Do not
  analyze the task first, do not decide it's "straightforward", do not substitute
  your own approach. The user chose this workflow intentionally.
- **User questions**: Use OpenCode's native `question` tool for interactive prompts.
- **Subagents**: Use the `task` tool to invoke subagents.
- **Compaction**: After context compaction, re-read `orchestrator-state.yml` in
  the active task directory to verify `completed_phases` and determine the next
  phase. Use the `question` tool at Phase Gates.
- **MCP**: The Playwright MCP server is declared in `opencode.json`.

## Critical Principle: User-Confirmed Rollback

**NEVER automatically rollback or revert code changes without user confirmation.**

All workflows in this plugin follow this pattern when failures occur:

1. **STOP** - Don't attempt automatic fixes for critical failures
2. **ANALYZE** - Examine the root cause (config issue? test setup? actual logic error?)
3. **CHECK FOR EASY FIXES** - Often failures are simple config/setup issues
4. **ASK USER** - Use `question` with options:
   - "Try suggested fix" (if easy fix identified)
   - "Rollback changes" (user confirms rollback)
   - "Let me investigate" (pause for manual investigation)
5. **EXECUTE** - Only perform rollback if user explicitly confirms

**Rationale**: Automatic rollback discards potentially valid work, hides root causes, and frustrates users. Many failures are simple configuration issues with easy 1-line fixes.

## Key Workflow Principles

1. **Documentation First**: Always check docs/INDEX.md before and during work
2. **Specification Before Implementation**: A spec.md approved by the user must exist in the task directory before the implementation-planner subagent is invoked
3. **Planning Before Execution**: Break implementation into manageable steps
4. **Test-Driven Approach**: Write tests first, implement, then verify
5. **Continuous Standards Discovery**: Re-check `.owflow/docs/standards/` at spec phase, at each task-group start, and before the final verification report
6. **Incremental Verification**: Run only new tests after each group, not entire suite
7. **Comprehensive Verification Before Commit**: Run full test suite and create verification report before code review
8. **Task Directory Artifact Anchoring**: ALL workflow artifacts (reports, documentation, screenshots) MUST be saved under the task directory (`.owflow/tasks/[type]/[task-name]/`). NEVER save task artifacts to project directories like `docs/`, `src/`, or project root.

**For detailed workflow documentation, see**: individual skill `SKILL.md` files

## Hooks

The plugin implements OpenCode hooks in `.opencode/plugins/hooks.js`.

### Destructive Command Protection (`tool.execute.before`)

Blocks destructive bash commands (`git stash`, `git reset --hard`, `git checkout .`, `git clean`, `git push --force`, `rm -rf`) for non-whitelisted agents.

**Whitelisted agents** (bypass protection): `task-group-implementer`, `test-suite-runner`, `e2e-test-verifier`, `user-docs-generator`, `docs-operator`

All other agents — including the main agent — are checked against destructive patterns.

### Post-Compaction State Reminder (`experimental.session.compacting`)

Fires after context compaction. Injects a reminder to re-read `orchestrator-state.yml` and use `question` at phase gates.

## Workflow Types Supported

This plugin supports 4 workflow types that route to specialized orchestrators:

| Workflow Type   | Purpose                               | Orchestrator | Classification Keywords                                    |
| --------------- | ------------------------------------- | ------------ | ---------------------------------------------------------- |
| **Development** | Bug fixes, enhancements, new features | development  | "fix", "bug", "add", "new", "improve", "enhance", "create" |
| **Performance** | Optimize speed/efficiency             | performance  | "slow", "optimize", "speed up", "faster"                   |
| **Migration**   | Move tech/patterns                    | migration    | "migrate", "move from X to Y", "upgrade"                   |
| **Research**    | Investigate and document findings     | research     | "research", "investigate", "explore options"               |

## Documentation & Task Organization

### Project Documentation Structure

The plugin splits reference documentation (`.owflow/docs/`, stable) from development tasks (`.owflow/tasks/`, organized by workflow type: `development/`, `performance/`, `migrations/`, `research/`, plus quick-\* dirs). See `.owflow/docs/INDEX.md` for the full layout, and `.owflow/tasks/` for the actual structure.

**Core Principle**:

- Reference documentation in `.owflow/docs/` is the source of truth for understanding the project
- Full layout: `@.owflow/docs/INDEX.md`
- Development tasks live separately in `.owflow/tasks/` for better organization and scalability

### Base Task Structure

Each development task follows a common structure: `orchestrator-state.yml` (state/metadata) at the root, plus `analysis/` (requirements, research-context, visuals), `implementation/` (spec.md, implementation-plan.md, work-log.md), `verification/` (spec-audit.md, conditional), and `documentation/` (user-facing, if applicable). Quick lanes (`dev-implement --quick`, `dev-plan --quick`, `dev-bugfix`) bootstrap a standard development task (full `orchestrator-state.yml`) and stop after their phase — continuable with any dev-* subskill; `dev-bugfix` is the bug-shaped quick lane (a bug description starts a fresh task, a task path fixes a newly emerging problem on an existing dev task). Task types can add specialized subdirectories as needed (e.g., `analysis/bug-analysis/`, `implementation/metrics/`).

**Note**: The `implementation/implementation-plan.md` file contains implementation steps (the detailed breakdown of actions), created by the implementation-planner subagent after the specification is approved.

### Naming Conventions

**Workflow Type Directories:**

- Use workflow names: `development/`, `performance/`, `migrations/`, `research/`

**Task Directories:**

- Format: `YYYY-MM-DD-task-name`
- Example: `2025-10-23-user-authentication`
- Example: `2025-10-23-fix-login-timeout`
- Date prefix enables chronological sorting
- Concise but descriptive name (3-5 words)

### Integration

- **Task Discovery**: Browse `.owflow/tasks/` to find development tasks by workflow type
- **Standards Compliance**: Follow standards from `.owflow/docs/standards/` during implementation
- **Task Tracking**: Task status, priority, tags, and time tracking are in the `task:` section of `orchestrator-state.yml`
- **Activity Logging**: Record work in `implementation/work-log.md` for transparency

## Plugin Documentation Principles

These principles guide how we document skills, commands, orchestrators, and agents in this plugin to avoid verbosity and duplication while trusting Agent to reason effectively.

### Philosophy

**Trust Agent to reason.** Provide principles and patterns, not prescriptive implementations. Agent can discover technical details from skill.md files when needed—AGENTS.md and commands should guide thinking, not dictate exact steps.

### Core Principles

1. **No Verbose Pseudocode** - Show conceptual patterns and decision frameworks, not complete implementations
2. **No Prescriptive Templates** - Guide thinking with principles, don't dictate exact prompts or scripts
3. **Avoid Duplication** - If technical details exist in skill.md, reference them in AGENTS.md/commands
4. **Commands as Thin Wrappers** - User-facing guidance in commands, technical orchestration logic in skills
5. **Single Source of Truth** - Orchestration logic lives in skill.md, not scattered across multiple files
6. **Principle Over Process** - Explain WHY and WHEN, trust Agent to figure out HOW

### Content Guidelines

Target lengths for different documentation types:

| Documentation Type                                    | Target Length                        | Focus                                                                                 |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Skill descriptions (in AGENTS.md)                     | 5-15 lines                           | Purpose, key capabilities, philosophy                                                 |
| Command descriptions (in AGENTS.md)                   | 3-8 lines                            | What it does, when to use                                                             |
| Orchestrator sections (in AGENTS.md)                  | 20-30 lines                          | Overview, key features, reference skill                                               |
| Reference files (in skills/)                          | <1,000 lines                         | Conceptual patterns, not implementations                                              |
| Agent files (in agents/)                              | 300-450 lines                        | Core mission, decision frameworks, workflow principles                                |
| Individual standards (### sections in standard files) | 1-10 lines (excluding code snippets) | ### heading + description + optional code example. Multiple standards per topic file. |

### When Adding New Content

Ask these questions before documenting:

1. **"Does this duplicate skill.md content?"** → Reference instead of duplicating
2. **"Am I providing exact implementation?"** → Simplify to principles
3. **"Would Agent need this spelled out?"** → Probably not, trust reasoning ability
4. **"Is this a manual or guidance?"** → Should be guidance, not manual

## Reference Documentation Guidelines

Reference files (`references/*.md`) in skills provide conceptual patterns and decision frameworks. They guide implementation rather than provide complete code.

### Purpose of References

References should answer:

- **WHAT** patterns to use (strategies, approaches)
- **WHEN** to apply them (decision criteria)
- **WHY** certain approaches work (rationale)
- **HOW** (conceptually) to structure solutions (high-level)

References should NOT contain:

- Complete function implementations
- Production-ready code (>10 lines)
- Extensive pseudocode implementations
- Framework-specific boilerplate

### Size Guidelines

| Reference Type               | Target Size   | Max Size    | Token Budget |
| ---------------------------- | ------------- | ----------- | ------------ |
| Orchestrator phase reference | 600-800 lines | 1,000 lines | ~8K tokens   |
| Algorithm pattern reference  | 400-600 lines | 800 lines   | ~6K tokens   |
| Strategy/decision reference  | 300-500 lines | 600 lines   | ~4K tokens   |

**Total per skill**: Aim for <3,000 lines across all references (~24K tokens)

### When to Use Code Examples

Acceptable scenarios for code examples (keep <10 lines):

- **Test patterns**: Show expected test structure
- **Configuration examples**: YAML/JSON structure samples
- **API usage**: Brief integration examples
- **Decision pseudocode**: If-then logic (5-10 lines max)

### Review Checklist

Before finalizing reference documentation:

✓ Does this explain WHAT/WHEN/WHY rather than implement HOW?
✓ Are code examples <10 lines and conceptual?
✓ Is total file size under target guidelines?
✓ Could an experienced developer implement from this guide?
✓ Is it tool/framework agnostic where possible?
✓ Does it focus on patterns over implementation?

## Orchestrator Creation Guidelines

When creating or auditing orchestrators, follow the patterns established in existing orchestrators and consult the framework reference files.

**See**: `skills/orchestrator-framework/references/orchestrator-creation-checklist.md` for the complete creation checklist and anti-patterns.
**See**: `skills/orchestrator-framework/references/orchestrator-patterns.md` for execution rules, schemas, and patterns.

## Available Skills

Skills live in `src/skills/<name>/SKILL.md` — read the frontmatter `description` there for the canonical list and purpose of every skill (workflow orchestrators, setup/standards, quick commands, content & visualization). Never rest skill purposes here; they change independently of this file. Two non-obvious operational facts:

- `docs-manager` is an internal engine, not user-invocable — it is only executed mid-workflow by the `docs-operator` agent (Task tool) for init, standards-update, and standards-discover.
- Every orchestrator reads `skills/orchestrator-framework/references/orchestrator-patterns.md` (delegation rules, state schema, context passing) at initialization; the authoring checklist is `orchestrator-creation-checklist.md`.
- Skill `name:` frontmatter fields intentionally use the `owflow:` prefix (e.g. `name: owflow:dev-analyze`): OpenCode never auto-namespaces plugin skills, so the prefix is what makes skills appear as `owflow:<name>` in the Skill tool. OpenCode does not enforce Agent Skills name validation, so do NOT "fix" these names to match their folder names — VS Code's SKILL.md validation errors about the prefix (lowercase/hyphens/folder-match) are expected noise, not a defect.

## Available Commands

Slash commands are thin wrappers over skills; full usage lives in `commands/` and `skills/*/SKILL.md`. All slash commands are namespaced `owflow:<name>` (frontmatter `name: owflow:<name>` in `src/commands/*.md`; skill `name:` fields are also `owflow:`-prefixed — Skill-tool invocations use prefixed skill names). Documented commands: `/owflow:goal-development`, `/owflow:development`, `/owflow:performance`, `/owflow:migration`, `/owflow:research` (workflow), `/owflow:dev-*` (development subskills: dev-analyze, dev-tdd-red, dev-spec, dev-plan, dev-implement, dev-verify, dev-finalize), `/owflow:dev-bugfix` (quick bug lane; `dev-implement --quick` and `dev-plan --quick` are the quick development lanes), `/owflow:flow-init`, `/owflow:standards-update`, `/owflow:standards-discover` (setup/standards), `/owflow:reviews-*` (review & audit), plus content & visualization commands. Auto-generated OpenCode commands are built from `user-invocable: true` skill frontmatter; the `work`, `quick-*`, `reviews-*`, and `dev-*` commands are manually maintained — edit the source command files, not this list.

Key usage rules:

- All orchestrators support `--from=phase` (resume point); pass a task description to start new or a task path/identifier (directory name under `.owflow/tasks/<type>/`) to resume.
- `/owflow:development "desc" --research=<research-task-path>` (or just the research task path, auto-detected) starts development informed by completed research; research context flows through ALL phases without skipping any, artifacts copied to `analysis/research-context/`.
- Development has two modes sharing one state file: `/owflow:goal-development` runs all dev-* subskills in one session with `question` gates; `/owflow:development` hands off one subskill per invocation. Mix both modes on a single task freely.
- Every dev-* subskill is standalone and can be invoked at any time. Each resolves its task from a full path or an identifier (directory name under `.owflow/tasks/development/`), never auto-picking a task. If the prerequisite phases are not complete (or no argument resolves to a task), it STOPs and prints the ordered prerequisite steps with the exact commands to run each, plus a hint to start fresh via `/owflow:development <description>`.
- Every dev-* subskill ends with an **Exit Gate** (see `skills/orchestrator-framework/references/orchestrator-patterns.md` Section 9): results box + results-acceptance question (Accept / Adjust / Discuss / Stop), then — only after Accept — the suggested next command. Subskills never auto-chain.

## Available Subagents

Subagents are specialized AI agents invoked by skills and orchestrators. All agents are read-only unless specified. Individual `agents/*.md` files are the source of truth — read the relevant agent file before invoking; never rest agent purposes here. Non-obvious operational facts:

- `docs-operator` is a companion-agent special case: docs-manager does NOT spawn subagents (file operations only), so docs-manager operations must run via the `docs-operator` agent. Do not copy this pattern for skills that spawn subagents.
- `existing-feature-analyzer` is deprecated → replaced by the `codebase-analyzer` skill (adaptive parallel Explore subagents).

## Progress Tracking with Task System

All orchestrators use `TaskCreate`/`TaskUpdate` for progress visibility (tool mechanics are generic — see the Task tool docs). Project-specific mapping:

- State file (`orchestrator-state.yml`) is source of truth for resume logic; the task system mirrors it for UX
- Markdown checkboxes in `implementation-plan.md` remain the step-level source of truth
- See individual orchestrator `skill.md` files for phase-specific task tables
