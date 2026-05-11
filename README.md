![Owflow logo](logo.png)

# Owflow

**Structured, standards-aware development workflows for OpenCode**

Describe what you want to build, and the plugin handles the rest - from specification through implementation to verification - while enforcing your project's coding standards at every step.

Started as a simple OpenCode fork of [Maister Claude Code plugin](https://github.com/SkillPanel/maister), Owflow aims to deliver production ready workflows using the full [Opencode](https://opencode.ai/) plugin support.

## What You Get

- **Guided workflows** for features, bug fixes, enhancements, performance, migrations, research, and product design
- **Auto-discovered standards** from your codebase - config files, source patterns, and documentation are analyzed and enforced throughout every workflow
- **Test-driven implementation** with automated planning, incremental verification, and full test suite runs before completion
- **Pause and resume** any workflow - state is preserved across sessions
- **Production readiness checks** including code review, reality assessment, and pragmatic over-engineering detection

## Getting Started

### Prerequisites

- [Opencode](https://opencode.ai/) CLI installed and configured
- [Node.js](https://nodejs.org/) >= 25

### Installation

#### Install the plugin

```bash
npm install owflow
```

#### Add owflow to the `plugin` array in your `opencode.json` ([global or project-level](https://opencode.ai/docs/plugins/#load-order)):

```json
{
  "plugin": ["owflow"]
}
```

### Initial project setup

Initialize your project to auto-detect coding standards and generate project documentation:

```bash
/flow-init
```

This scans your codebase and creates `.owflow/` with standards, docs, and task folders. May take a few minutes on larger projects.

If you have another project already using Owflow, you can reuse its standards as a starting point:

```bash
/flow-init --standards-from=/path/to/other-project
```

### First Workflow

```bash
/development Add user profile page with avatar upload
```

Or just discuss your task with LLM model and then run:

```bash
/development
```

The plugin picks up context from your conversation - no arguments needed.

## How It Works

1. You describe a task - either as an argument or just in conversation
2. The plugin classifies it (feature, bug, enhancement, etc.) and proposes a workflow
3. You confirm, and it guides you through phases: **requirements → spec → plan → implement → verify**
4. At each phase, it asks for your input and decisions
5. You get tested, verified code with a detailed work log

All artifacts are saved in `.owflow/tasks/` organized by type and date.

### Context-Aware Commands

Every workflow command works without arguments. The plugin reads your current conversation to extract the task description and auto-detect the task type:

```
You: "The login page throws a 500 error when the session expires"
You: /development
→ Auto-detects: bug fix, extracts description from conversation
```

```
You: /standards-update
→ Scans conversation for patterns like "we always use..." or "prefer X over Y"
```

You can always be explicit when you prefer - arguments and flags simply override the auto-detection.

## Supported Workflows

| Command           | Use When                                    |
| ----------------- | ------------------------------------------- |
| `/development`    | Features, bug fixes, enhancements           |
| `/research`       | Research with synthesis and solution design |
| `/performance`    | Optimizing speed or resource usage          |
| `/migration`      | Changing technologies or patterns           |
| `/product-design` | Product and feature design                  |

Task type (feature/bug/enhancement) is auto-detected from context. Override with `--type=feature|bug|enhancement` if needed. Or use `/work` as a single entry point that routes to the right workflow.

### Quick Commands

For smaller tasks that don't need a full workflow:

| Command         | Use When                                                    |
| --------------- | ----------------------------------------------------------- |
| `/quick-plan`   | You want a plan with standards awareness before coding      |
| `/quick-dev`    | You know what to do - just implement with standards applied |
| `/quick-bugfix` | Quick TDD-driven bug fix — write failing test, fix, verify  |

## Standards-Aware Development

This is the key differentiator. Owflow doesn't just run workflows - it learns your project's conventions and enforces them:

- **`flow-init`** scans config files, source code, and documentation to auto-detect your coding standards
- **Continuous checking** - standards are consulted before specification, during planning, and while coding (not just at the start)
- **`/standards-discover`** refreshes standards from your evolving codebase
- **`/standards-update`** lets you add or refine standards manually, or sync from another project with `--from=PATH`

Standards live in `.owflow/docs/standards/` and are indexed in `.owflow/docs/INDEX.md`.

**Important**: Do not use plan mode with workflows (see [Best Practices](#best-practices) below).

## Beta Channel

Want to try experimental features before they hit stable? Install from the beta channel:

TBD

## Best Practices

**Don't use plan mode when starting a workflow.** Planning is a built-in part of every workflow — the orchestrator creates specs, plans, and other files as it goes. OpenCode's plan mode restricts file creation, which conflicts with this. Let the workflow handle planning on its own.

**Start workflows in a fresh session.** This is especially useful when chaining workflows (e.g., research → development). Research and product-design artifacts already contain all the context needed, so a clean session avoids noise from prior conversation.

**Chain workflows by passing a task folder.** If you've completed a research or product-design workflow and want to build on those results, pass the task folder directly:

```bash
/development .owflow/tasks/research/2026-01-12-oauth-research
```

You can also append additional instructions to narrow scope or guide the workflow:

```bash
/development .owflow/tasks/product-design/2026-03-10-dashboard-redesign Implement only phase 1
```

## Known Issues

**Orchestrator may stall after long phases.** After context compaction (which typically happens after lengthy phases like implementation), the main agent may stop progressing automatically. If you notice it's idle, just type something like "continue" or "proceed" — it will pick up where it left off. You can also re-invoke the workflow in resume mode to reload the orchestrator state:

```bash
/development .owflow/tasks/development/2026-03-24-my-feature
```

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
