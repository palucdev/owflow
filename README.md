![Owflow logo](logo.png)

# Owflow

**Structured, standards-aware development workflows for OpenCode**

Describe what you want to build, and the plugin handles the rest - from specification through implementation to verification - while enforcing your project's coding standards at every step.

Started as a simple OpenCode fork of [Maister Claude Code plugin](https://github.com/SkillPanel/maister), Owflow aims to deliver production ready workflows using the full [Opencode](https://opencode.ai/) plugin support.

## What You Get

- **Guided workflows** for features, bug fixes, enhancements, performance, migrations and research
- **Auto-discovered standards** from your codebase - config files, source patterns, and documentation are analyzed and enforced throughout every workflow
- **Test-driven implementation** with automated planning, incremental verification, and full test suite runs before completion
- **Pause and resume** any workflow - state is preserved across sessions
- **Production readiness checks** including code review, reality assessment, and pragmatic over-engineering detection

## Getting Started

### Directory Structure

```
owflow/
├── docs/                   # Plugin documentation (commands, workflows)
├── scripts/                # Build and utility scripts
└── src/                    # Source code
    ├── __tests__/          # Test suites
    ├── agents/             # Agent definitions and prompts (.md)
    ├── commands/           # OpenCode slash commands (.md)
    ├── configuration/      # Handlers for agent, command, and skill configurations
    ├── hooks/              # OpenCode lifecycle hooks (tool execution, compaction)
    ├── skills/             # Workflows, orchestrators, and reusable skills
    ├── templates/          # Orchestrator state and task YAML templates
    ├── tools/              # Custom OpenCode tool implementations
    ├── types/              # TypeScript type definitions
    ├── utils/              # Internal utility functions
    └── index.ts            # Main plugin entry point
```

### Prerequisites

- [Opencode](https://opencode.ai/) CLI installed and configured
- [Node.js](https://nodejs.org/) >= 25

### Installation

#### Add owflow to the `plugin` array in your `opencode.json` ([global or project-level](https://opencode.ai/docs/plugins/#load-order)):

To use it across multiple repos it is advised to use the global level:

Linux/MacOS:

```sh
~/.config/opencode/opencode.json
```

Windows:

```powershell
\Users\YourUsername\.config\opencode\opencode.json
```

In `opencode.json`:

```json
{
  ...
  "plugin": ["owflow@latest"]
  ...
}
```

### Initial project setup

Initialize your project to auto-detect coding standards and generate project documentation:

```bash
/owflow:flow-init
```

This scans your codebase and creates `.owflow/` with standards, docs, and task folders. May take a few minutes on larger projects.

If you have another project already using Owflow, you can reuse its standards as a starting point:

```bash
/owflow:flow-init --standards-from=/path/to/other-project
```

### First Workflow

```bash
/owflow:development Add user profile page with avatar upload
```

Or just discuss your task with Agent and then run:

```bash
/owflow:development
```

The plugin picks up context from your conversation - no arguments needed. Prefer everything in one session? Use `/owflow:goal-development` (autonomous mode) instead - it runs the same pipeline without handoffs between phases (subskills run back-to-back in one session).

## How It Works

1. You describe a task - either as an argument or just in conversation
2. The plugin classifies it (feature, bug, enhancement, etc.) and proposes a workflow
3. You confirm, and it guides you through the pipeline of development subskills: **analysis → spec → plan → implement → verify → finalize**
4. At each phase, it asks for your input and decisions
5. You get tested, verified code with a detailed work log

All artifacts are saved in `.owflow/tasks/` organized by type and date.

### Context-Aware Commands

Every workflow command works without arguments. The plugin reads your current conversation to extract the task description and auto-detect the task type:

```
You: "The login page throws a 500 error when the session expires"
You: /owflow:development
→ Auto-detects: bug fix, extracts description from conversation
```

```
You: /owflow:standards-update
→ Scans conversation for patterns like "we always use..." or "prefer X over Y"
```

You can always be explicit when you prefer - arguments and flags simply override the auto-detection.

## Supported Workflows

| Command                | Use When                                    |
| ---------------------- | ------------------------------------------- |
| `/owflow:development`  | Features, bug fixes, enhancements           |
| `/owflow:research`     | Research with synthesis and solution design |
| `/owflow:performance`  | Optimizing speed or resource usage          |
| `/owflow:migration`    | Changing technologies or patterns           |

Task type (feature/bug/enhancement) is auto-detected from context. Override with `--type=feature|bug|enhancement` if needed. Or use `/owflow:work` as a single entry point that routes to the right workflow.

### Quick Commands

For smaller tasks that don't need a full workflow:

| Command                          | Use When                                                    | Artifacts                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/owflow:dev-bugfix`             | Quick TDD-driven bug fix — write failing test, fix, verify  | `orchestrator-state.yml`, `analysis/findings.md`, `summary.md`                                                                            |
| `/owflow:dev-implement --quick`  | Task is clear, no architectural decisions needed            | `orchestrator-state.yml`, `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`, `work-log.md` |
| `/owflow:dev-plan --quick`       | Standards-aware, resumable plan before coding — plan only   | `orchestrator-state.yml`, `analysis/quick-analysis.md`, `implementation/spec.md`, `implementation/implementation-plan.md`                |

`/owflow:dev-bugfix` creates a standard development task under `.owflow/tasks/development/` (full `orchestrator-state.yml`, entry point `dev-bugfix`) and runs a condensed bug fix slice (analyze + approve plan → TDD red → fix → TDD green). Pass a task path to fix a newly emerging problem on an existing development task; the task remains continuable by any dev-* subskill (`/owflow:dev-verify`, `/owflow:development <task-path>`, …).

Quick development uses the standard pipeline instead: `/owflow:dev-implement --quick "<description>"` bootstraps a regular development task (`orchestrator-state.yml`, condensed spec + plan), implements it, and stops — continue later with `/owflow:dev-verify` or stop there if the results are enough. Plan-only tasks work the same way: `/owflow:dev-plan --quick "<description>"` bootstraps a regular development task and stops after the plan — continue with `/owflow:dev-implement` or stop there if the plan is enough.

**The `--quick` flag is optional.** You can start from a bare prompt — the skill bootstraps the task and then asks whether to run the condensed quick lane or escalate to the full pipeline. Pass `--quick` to skip that question and go straight to the quick lane. Invoked with no argument at all, the skill prompts you for a task description, task path, or identifier. Bug-shaped descriptions route to `/owflow:dev-bugfix` instead (you can insist on proceeding if you prefer).

```bash
# Quick lane, no questions asked
/owflow:dev-implement --quick "Add a logout button to the navbar"
/owflow:dev-plan --quick "Add server-side pagination to the users list"

# Bare prompt — the skill asks: quick lane or full pipeline?
/owflow:dev-implement "Add CSV export to the invoices table"
/owflow:dev-plan "Add rate limiting to the public API"

# No argument — prompts for a description, task path, or identifier
/owflow:dev-implement
/owflow:dev-plan
```

### Fine-Grained Control: Development Subskills

The full `/owflow:development` workflow consists of standalone subskills — `/owflow:dev-analyze`, `/owflow:dev-tdd-red`, `/owflow:dev-spec`, `/owflow:dev-plan`, `/owflow:dev-implement`, `/owflow:dev-verify`, `/owflow:dev-finalize` — which you can also invoke individually. Each accepts a task path, or just a task-directory identifier:

```bash
/owflow:dev-spec 2026-01-12-my-feature
/owflow:dev-verify .owflow/tasks/development/2026-01-12-my-feature
```

If a subskill is invoked too early in the workflow (prerequisite phases not yet complete), it stops and tells you exactly which steps to run first, in order. If the workflow state doesn't exist yet, use `/owflow:development <description>` to start from scratch.

## Standards-Aware Development

This is the key differentiator. Owflow doesn't just run workflows - it learns your project's conventions and enforces them:

- **`/owflow:flow-init`** scans config files, source code, and documentation to auto-detect your coding standards
- **Continuous checking** - standards are consulted before specification, during planning, and while coding (not just at the start)
- **`/owflow:standards-discover`** refreshes standards from your evolving codebase
- **`/owflow:standards-update`** lets you add or refine standards manually, or sync from another project with `--from=PATH`

Standards live in `.owflow/docs/standards/` and are indexed in `.owflow/docs/INDEX.md`.

**Important**: Do not use plan mode with workflows (see [Best Practices](#best-practices) below).

## Beta Channel

Want to try experimental features before they hit stable? Install from the beta channel:

TBD

## Best Practices

**Don't use plan mode when starting a workflow.** Planning is a built-in part of every workflow — the orchestrator creates specs, plans, and other files as it goes. OpenCode's plan mode restricts file creation, which conflicts with this. Let the workflow handle planning on its own.

**Start workflows in a fresh session.** This is especially useful when chaining workflows (e.g., research → development). Research artifacts already contain all the context needed, so a clean session avoids noise from prior conversation.

**Chain workflows by passing a task folder.** If you've completed a research workflow and want to build on those results, pass the task folder directly — by path, or just by its directory identifier if the name is unique:

```bash
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research
```

You can also append additional instructions to narrow scope or guide the workflow:

```bash
/owflow:development .owflow/tasks/research/2026-01-12-oauth-research Implement only phase 1
```

## Known Issues

**Orchestrator may stall after long phases.** After context compaction (which typically happens after lengthy phases like implementation), the main agent may stop progressing automatically. If you notice it's idle, just type something like "continue" or "proceed" — it will pick up where it left off. You can also re-invoke the workflow in resume mode to reload the orchestrator state:

```bash
/owflow:development .owflow/tasks/development/2026-03-24-my-feature
```

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
