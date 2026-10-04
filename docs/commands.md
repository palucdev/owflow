# Command Reference

Every owflow command is invoked as `/owflow:<name>`. The `owflow:` prefix is part of the name — OpenCode does not add a plugin namespace for you, so the bare `<name>` does not resolve.

This page is the **command surface**: what each command is for, what arguments it takes, which flags it reads, and where its text comes from. For how a workflow actually runs — steps, gates, artifacts, task-directory layout — see [Workflow Details](workflows.md).

## How Commands Are Registered

Commands come in **two kinds**, and the kind tells you where the text you see when you invoke one comes from.

| Kind | Where its text comes from | To change it, edit |
| --- | --- | --- |
| **Maintained content command** | A markdown file in `src/commands/`, one file per command. The whole body is authored there: which subagent or skill to invoke, how to read the user's arguments, and worked examples. | `src/commands/<name>.md` |
| **Synthesized wrapper** | Generated at config time from a `SKILL.md` frontmatter block — one wrapper per skill marked `user-invocable: true`. The body holds no workflow logic; it is an instruction to invoke the skill. | that skill's `SKILL.md` frontmatter |

The plugin registers **6 maintained** commands and **39 synthesized** wrappers. Both numbers follow from the rules above rather than being independent facts: one file per maintained command, one wrapper per invocable skill. What registers is read from disk at config time, and `bun test src` asserts only the resulting totals — 45 commands, of which 39 are synthesized. The suite does not pin the exact name set, so renaming a skill's `name` frontmatter renames its command without failing a test.

### The maintained content commands

`/owflow:work` and the five `/owflow:reviews-*` commands. They exist as files because each one routes to or delegates to a subagent directly and owns logic no skill holds — classification and routing for `work`, argument dispatch for the reviews.

### What a synthesized command contains

Every synthesized body is the same fixed shape, built by `renderCommandTemplate` in `src/configuration/commands-config.ts`. The only per-command part is the skill name:

```text
CRITICAL INSTRUCTION: You MUST invoke the owflow:<name> skill immediately as your FIRST action.

Use the Skill tool with these exact parameters:
name: "owflow:<name>"
prompt: "$ARGUMENTS"
```

Two consequences follow from that split:

- **The `/help` line you pick a command from is the skill's own `description`.** Changing a command's palette text means editing the skill's `description`, not a command file.
- **No command carries an "About this workflow" section.** The palette line and the skill body are the documentation. If you want the detail, invoke the command or read the skill.

A wrapper forwards `$ARGUMENTS` verbatim, so the arguments a synthesized command accepts are the ones its skill parses — described by that skill's `argument-hint` frontmatter, and repeated per command below.

## Picking a Command

| If you want to… | Use |
| --- | --- |
| Let the plugin classify the work and route it to the right workflow | `/owflow:work` |
| Build a feature, fix a bug, improve existing code | `/owflow:development` (one step per invocation) or `/owflow:goal-development` (the whole loop in one session) |
| Fix an isolated bug with a TDD red/green gate | `/owflow:dev-bugfix` |
| Enter or re-enter the development pipeline at a specific step | the matching `/owflow:dev-*` subskill |
| Speed something up | `/owflow:performance` |
| Move a technology, platform, or architecture pattern | `/owflow:migration` |
| Investigate a question and document the findings | `/owflow:research` (one step per invocation) or `/owflow:goal-research` (the whole loop) |
| Branch a research task to explore different choices | `/owflow:research-fork` |
| Review code quality, whether the work is really done, a spec, or production readiness | the `/owflow:reviews-*` commands |
| Set up the framework in a project | `/owflow:flow-init` |
| Discover or refine coding standards | `/owflow:standards-discover`, `/owflow:standards-update` |
| Generate an agent onboarding file, a Mermaid diagram, a shareable HTML page, or a rules-file score | `/owflow:agents-md-generator`, `/owflow:diagrams-mermaid`, `/owflow:html-renderer`, `/owflow:rule-reviewer` |

---

## `/owflow:work [input]`

The single entry point. Auto-classifies a task and routes it to the matching workflow, or resumes an existing task.

Accepted input: a task folder path, a bare folder name (searched across all task types), a task description, a GitHub / Jira / Azure DevOps issue identifier or URL, or nothing at all — with no argument it asks what you want to work on.

Classification runs through the `task-classifier` subagent, which can fetch the issue's details, weighs the codebase context, scores confidence, and confirms with you when needed. If it cannot classify, it offers the four workflow types instead. After that the command invokes the matching orchestrator skill with your description; for an existing task it resumes, offering restart-from-step, retry, or a fresh-attempt resume (`--reset-attempts`) when the task has failed phases.

Task folders are read from `.owflow/tasks/<type>/` — the type is taken from the folder it sits in.

---

## Development

### `/owflow:development [task description | task-path]`

The development **dispatcher**: initializes or resumes a task, derives the next pending step from the task's state, prints the subskill command that handles it, and stops. One invocation, one step — each `dev-*` subskill runs in a fresh context.

Pass a description to start a task, or a task path to resume one. `/owflow:goal-development` runs the same task lifecycle with every subskill invoked for you, one after another, in a single session.

| Flag | Effect |
| --- | --- |
| `--from=<step-slug>` | Hand off from a specific step |
| `--research=PATH` | Link to a completed research task |
| `--audit` / `--no-audit` | Force/skip the specification audit |
| `--e2e` / `--no-e2e` | Force/skip E2E testing |
| `--user-docs` / `--no-user-docs` | Force/skip user documentation |
| `--reset-attempts` | Reset failed attempt counters (resume) |

The phase flags are written into the task's state as options and the subskills read them from there; `--research=PATH` instead records the linked research task in state. `--reset-attempts` is a development-dispatch flag — `/owflow:performance` resumes on `--from=PHASE` and `/owflow:migration` on `--from=<slug>`, and neither reads it.

Starting from a completed research task is either naming the research folder as the sole argument or passing `--research=PATH` alongside a description. Either way the research context informs every subskill; it never skips one.

### `/owflow:goal-development [task description | task-path]`

Autonomous mode. Same task lifecycle and same state file as `/owflow:development`, but it invokes every required `dev-*` subskill back to back, using each subskill's own exit gate as the loop gate. Accepts the same flags, minus `--reset-attempts`. Interruptible at any gate: answering "stop" ends the session and prints the resume command, and the task picks up later in either mode.

### The `/owflow:dev-*` subskills

Each is standalone and resolves its task from a full path or the directory name under `.owflow/tasks/development/`. It never auto-picks a task. Invoked with a step it cannot yet take, it stops and prints the ordered prerequisite commands instead.

| Command | Arguments | What it does |
| --- | --- | --- |
| `/owflow:dev-analyze` | `[task-path-or-identifier]` | Codebase analysis with clarifications, then gap analysis with scope decisions |
| `/owflow:dev-tdd-red` | `[task-path-or-identifier]` | TDD Red Gate — a failing test that reproduces the defect, written before any implementation work |
| `/owflow:dev-spec` | `[task-path-or-identifier \| "description"] [--quick]` | Technical approach, requirements, specification, and the optional specification audit |
| `/owflow:dev-plan` | `[task-path-or-identifier \| "description"] [--quick]` | Breaks the approved specification into a grouped, dependency-ordered implementation plan |
| `/owflow:dev-implement` | `[task-path-or-identifier \| "description"] [--quick]` | Executes the plan by delegation, then the TDD Green Gate when a red gate exists |
| `/owflow:dev-verify` | `[task-path-or-identifier]` | Verification options, comprehensive verification, and a user-driven fix loop |
| `/owflow:dev-finalize` | `[task-path-or-identifier]` | Conditional E2E testing and user documentation, then finalization with commit guidance |
| `/owflow:dev-bugfix` | `[bug description \| task-path-or-identifier]` | Quick TDD-driven bug fix, with escalation when the bug turns out not to be simple |

### Quick lanes

Quick lanes are **flags, not commands**, and every one of them creates a standard development task with the lane recorded as `orchestrator.entry_point`, so any subskill can pick it up afterwards. The flag is optional — a description with no existing task lets the skill bootstrap and then ask whether to run the condensed lane or escalate to the full pipeline.

| Lane | Reaches | Stops at |
| --- | --- | --- |
| `/owflow:dev-spec --quick "<description>"` | A standards-aware, resumable specification | the `dev-spec` exit gate |
| `/owflow:dev-plan --quick "<description>"` | A standards-aware implementation plan | the `dev-plan` exit gate |
| `/owflow:dev-implement --quick "<description>"` | Direct implementation in the main agent, with the standards already read | the `dev-implement` exit gate |
| `/owflow:dev-bugfix "<description>"` | A fixed bug, red gate to green gate | the fix-run summary, then `/owflow:dev-verify` or a commit |

`/owflow:dev-bugfix` has two invocation modes: a bug description bootstraps a fresh task, while a task path or identifier fixes a problem that emerged on an existing development task — the fix is appended and the downstream verification steps are reset so verification re-runs.

The quick lanes skip delegation and audit, not discipline. A bug-shaped description with a reproducible defect still goes through the TDD red gate; `--quick` never bypasses it, and the skill points you at `/owflow:dev-bugfix` instead.

### Code review inside the development workflow

Whether the code-review subagent runs is a **state option, not a command flag**. `code_review_enabled` lives in the task's `orchestrator-state.yml` and ships as `true` in the development state template; the verification step reads it and delegates to the `code-reviewer` subagent when it is set, writing `verification/code-review-report.md`. `/owflow:performance` carries the same option and asks which additional checks to run at its verification-options phase. To run that review on its own at any time, use `/owflow:reviews-code` on any path.

---

## Research

### `/owflow:research [task description | task-path] [--from=<slug>] [--type=<type>]`

The research **dispatcher**: initializes or resumes a research task, derives the next step from state, and hands off to the matching `research-*` subskill. `/owflow:goal-research` runs the same lifecycle with every subskill invoked for you, in one session. Both take:

| Flag | Effect |
| --- | --- |
| `--from=<slug>` | Hand off from a specific step slug |
| `--type=<type>` | Force the methodology classification: `technical`, `requirements`, `literature`, or `mixed` |

`--type` is written to the task's `research_context.research_type`; the subskills read it from there. The optional brainstorm and design chain has no flag — invoking the subskill **is** the decision to run it, and `goal-research` asks at the gate after synthesis.

### The `/owflow:research-*` subskills

Each is standalone, resolves its task from a full path or the directory name under `.owflow/tasks/research/`, and stops with the ordered prerequisite steps when something is missing.

| Command | Arguments | What it does |
| --- | --- | --- |
| `/owflow:research-plan` | `[task-path-or-identifier \| "description"] [--quick]` | Research brief, methodology selection, and the plan with a parsable Gathering Strategy |
| `/owflow:research-gather` | `[task-path-or-identifier]` | The parallel findings fan across source categories, merged per category |
| `/owflow:research-synthesize` | `[task-path-or-identifier]` | Synthesis and the evidence-based research report, with per-finding confidence |
| `/owflow:research-brainstorm` | `[task-path-or-identifier]` | Multi-perspective solution alternatives (optional) |
| `/owflow:research-converge` | `[task-path-or-identifier]` | One approach decision per decision area, presented in full detail each time |
| `/owflow:research-design` | `[task-path-or-identifier]` | High-level architecture design plus a decision log (optional) |
| `/owflow:research-finalize` | `[task-path-or-identifier]` | Output inventory, results confirmation, completion |
| `/owflow:research-quick` | `[task-path-or-identifier \| "description"] [--quick]` | The quick lane: brief, plan, gather, and synthesis condensed into one pass |

`/owflow:research-quick` produces the same standard artifacts and state as the full lane and is continuable at full fidelity by any research subskill.

### `/owflow:research-fork <task-path-or-identifier> ["<what this fork should explore>"] [--from=<slug>] [--name="..."]`

Copies a research task directory wholesale into a new task, then trims the copy's state so it continues from a chosen completed step. A bare task path is enough: the skill reads the source research and asks for the fork's intent, fork point, and name, with suggestions. The source task is never modified, and the copy is a plain research task from then on.

---

## Performance and Migration

### `/owflow:performance [task description | task-path]`

Static-analysis-first optimization: reads the code to find bottlenecks — N+1 queries, missing indexes, O(n²) algorithms, blocking I/O, memory leaks — then runs the standard specification, planning, implementation, and verification phases. Given nothing, it asks what is slow and what profiling data you have; the workflow provides a directory for flame graphs and APM screenshots. Resume with `--from=PHASE`. At its verification-options phase it asks which additional checks to run and records the answer in state.

### `/owflow:migration [task description | task-path]`

Technology, platform, and architecture-pattern migrations with risk assessment, incremental execution, and mandatory rollback planning. Given nothing, it asks what is being migrated and to what. `/owflow:goal-migration` runs the same lifecycle with every subskill invoked for you, in one session.

The migration **dispatcher** derives the next step from state and hands off to the matching `migration-*` subskill. `--type` is written to `migration_context.migration_type` as a default — `migration-target` still confirms a low-confidence classification. Data migrations add integrity checks and a dual-run.

| Flag | Effect |
| --- | --- |
| `--from=<slug>` | Hand off from a specific step slug |
| `--type=TYPE` | Set the migration type — `code`, `data`, `architecture`, or `general` |
| `--no-web-research` | Skip the external web research step (recorded as not performed) |

#### The `/owflow:migration-*` subskills

Each is standalone, resolves its task from a full path or the directory name under `.owflow/tasks/migrations/`, and stops with the ordered prerequisite steps when something is missing.

| Command | Arguments | What it does |
| --- | --- | --- |
| `/owflow:migration-analyze` | `[task-path-or-identifier]` | Current-state analysis and migration-scoped clarifications |
| `/owflow:migration-target` | `[task-path-or-identifier] [--type=TYPE] [--no-web-research]` | Target-state plan, type classification, and the risk lock |
| `/owflow:migration-spec` | `[task-path-or-identifier]` | Requirements, strategy specification, and rollback/dual-run plans |
| `/owflow:migration-plan` | `[task-path-or-identifier]` | Implementation plan with per-group rollback steps |
| `/owflow:migration-implement` | `[task-path-or-identifier]` | Plan execution and the work log |
| `/owflow:migration-verify` | `[task-path-or-identifier]` | Verification options, verification, and compatibility testing |
| `/owflow:migration-fix` | `[task-path-or-identifier]` | Conditional issue resolution (halts on data integrity) |
| `/owflow:migration-finalize` | `[task-path-or-identifier]` | Optional migration guide and task completion |

---

## Reviews and Audits

Standalone: run them anytime, on any path or task, independent of a workflow. Each delegates straight to a subagent and writes its report beside what it reviewed.

| Command | Delegates to | Optional flags |
| --- | --- | --- |
| `/owflow:reviews-code [path]` | `code-reviewer` | `--scope=quality\|security\|performance\|all` (default: complete analysis) |
| `/owflow:reviews-pragmatic [path]` | `code-quality-pragmatist` | — |
| `/owflow:reviews-reality-check [task-path]` | `reality-assessor` | `--production` |
| `/owflow:reviews-spec-audit [spec-path]` | `spec-auditor` | `--post-implementation` (default: pre-implementation), `--focus=<area>` |
| `/owflow:reviews-production-readiness [path]` | `production-readiness-checker` | `--target=prod\|staging` (default: `prod` with full rigor) |

They are all read-only — no source is modified. `/owflow:reviews-reality-check` re-runs the tests itself rather than trusting the existing reports, exercises end-to-end flows and error scenarios, and returns a deployment verdict. `/owflow:reviews-production-readiness` covers configuration, monitoring, error handling, performance, security, and deployment, and ends in a GO/NO-GO recommendation.

---

## Setup and Standards

### `/owflow:flow-init [--standards-from=PATH]`

Initializes `.owflow/docs/` and `.owflow/tasks/` in a project: analyzes the codebase, presents its findings for confirmation, and generates project documentation and coding standards. Pass `--standards-from=PATH` to copy the standards from another project instead of the built-in defaults — the referenced project must have `.owflow/docs/standards/`. If `.owflow/` already exists, the pre-flight phase offers to back it up, update it, or cancel.

### `/owflow:standards-discover [task description]`

Discovers coding standards from project configuration files, code patterns, documentation, and external sources — pull requests and CI/CD pipelines — then presents the findings in confidence tiers for review before applying them.

| Flag | Effect |
| --- | --- |
| `--scope=SCOPE` | `full`, `quick`, or a category such as `frontend`, `backend`, `testing` (default: `full`) |
| `--confidence=N` | Minimum confidence threshold, 0-100 (default: `60`) |
| `--auto-apply` | Apply findings at 90%+ confidence without asking |
| `--skip-external` | Skip the PR and CI/CD sources |
| `--pr-count=N` | How many recent merged PRs to analyze |

### `/owflow:standards-update [description of standard/convention] [--from=PATH]`

Creates or updates a standard from conversation context or an explicit description; with no arguments it scans the current conversation for convention statements and proposes them as new standards. `--from=PATH` switches to sync mode — analyzing what differs between this project's standards and another project's, and letting you select which to import. Note that `--from` means a **step slug** on the development, research, and migration commands, a **phase** on performance, and a **project path** here.

---

## Content and Utility Commands

Independent of the workflow families; each takes a path or a topic and does one job.

| Command | Arguments | What it does |
| --- | --- | --- |
| `/owflow:agents-md-generator` | `[directory or file path]` | Inspects the repository and writes a concise, reference-heavy agent onboarding guide (repo-level or directory-level scope) |
| `/owflow:diagrams-mermaid` | `[diagram description]` | Mermaid diagrams for planning flows, component communication, and architecture views, with adaptive detail selection including C4 levels |
| `/owflow:html-renderer` | `[path to markdown file]` | Renders a plan, idea, RFC, or design note into a self-contained, share-ready HTML file, written next to the source `.md` |
| `/owflow:rule-reviewer` | `[path/to/rules.md]` | Scores a rule-for-AI file (`AGENTS.md`, `CLAUDE.md`, or any rules file) on five axes and returns concrete, actionable fixes |

---

## Task Artifacts

Every workflow writes into `.owflow/tasks/<type>/YYYY-MM-DD-task-name/`, keyed by an `orchestrator-state.yml` that holds the step slugs, the options, and the accumulated phase summaries. The directory layout and which step writes which artifact are in [Workflow Details](workflows.md).
