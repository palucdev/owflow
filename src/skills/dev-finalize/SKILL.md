---
name: owflow:dev-finalize
description: Development — conditional E2E testing, user documentation, and workflow finalization with commit guidance.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Finalize — E2E, User Docs & Finalization (e2e-run, docs-generated, task-completed)

Closing phase of the development workflow. Runs optional E2E browser verification and user documentation when enabled, then finalizes the workflow.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Codebase & gap analysis (`codebase-analysed`, `gap-analysed`) → `/owflow:dev-analyze <task-path>`
     - TDD red gate (`tdd-red-proven`) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Requirements, specification & audit (`spec-written`, `spec-audited`) → `/owflow:dev-spec <task-path>`
     - Implementation planning (`plan-created`) → `/owflow:dev-plan <task-path>`
     - Implementation & TDD green gate (`implementation-done`, `tdd-green-proven`) → `/owflow:dev-implement <task-path>`
     - Verification & issue resolution (`options-chosen`, `verification-done`) → `/owflow:dev-verify <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                            | Produced by                        |
| ----------------------- | ----------------------------------------- | ---------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`      | `/owflow:development <desc>`       |
| Verification done       | `verification-done` in `completed_phases` | `/owflow:dev-verify <task-path>`   |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Prerequisite check**: `verification-done` in `completed_phases`. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: analysis (`codebase-analysed`, `gap-analysed`) → TDD red gate (`tdd-red-proven`, only when a reproducible defect was detected) → specification (`spec-written`) → implementation planning (`plan-created`) → implementation (`implementation-done`) → verification (`verification-done`).
   - `Run /owflow:dev-verify <task-path> first` (or the command for the earliest missing earlier step).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`
3. **Skip/resume**: if `task.status` is `completed`, report the existing finalization and STOP.
4. **Conditional activation**: if `options.e2e_enabled: false` and `options.user_docs_enabled: false`, skip straight to Finalization.

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### E2E Testing (`e2e-run`, conditional)

**Skip if** `options.e2e_enabled: false`.

Task tool - `e2e-test-verifier`. Prompt MUST include: task_path (absolute), spec_path (`implementation/spec.md`), base_url. Report saves to `{task_path}/verification/e2e-verification-report.md` with screenshots. This is runtime browser verification via Playwright MCP tools — not test file generation.

### User Documentation (`docs-generated`, conditional)

**Skip if** `options.user_docs_enabled: false`.

Task tool - `user-docs-generator`. Prompt MUST include: task_path (absolute), spec_path, base_url. Guide saves to `{task_path}/documentation/user-guide.md` with screenshots.

### Finalization (`task-completed`, inline)

1. Create workflow summary: what was built, phases executed, verification outcome, artifacts produced.
2. Update `task.status: completed` in state.
3. Provide commit message template (conventional style, referencing task name).
4. Guide next steps: code review, PR, deployment.

## State Update Convention (per step)

Apply after EVERY phase above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed plus that step's fields. Never batch multiple steps into one end-of-skill write:
   - After E2E testing (only when it ran): append `e2e-run` to `completed_phases`; record the E2E verdict; bump `orchestrator.updated`.
   - After user documentation (only when it ran): append `docs-generated` to `completed_phases`; record the guide location; bump `orchestrator.updated`.
   - After finalization: append `task-completed` to `completed_phases`; set `task.status: completed`; bump `orchestrator.updated`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the E2E run or documentation generation fails and cannot be recovered, do NOT append the corresponding slug to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`. Ask the user whether to retry or continue to finalization without that step.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then close the workflow (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ DEVELOPMENT WORKFLOW COMPLETE — <task name>

**Built** — [1-2 line summary of what was built]
**Steps** — [executed steps, e.g. codebase-analysed → task-completed]
**Verification** — [final verification outcome]
**E2E verdict** — [if run] / skipped
**User guide** — [path] / not generated

**Artifacts**
- `verification/e2e-verification-report.md` [conditional]
- `documentation/user-guide.md` [conditional]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — workflow is complete; show closing guidance.
- **Adjust** — re-run the affected optional phase (E2E or user docs) with the user's corrections, then re-present the results box.
- **Discuss** — walk through the finalization (summary, E2E verdict, guide contents, commit guidance) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-finalize <task-path>`) and end.

### Next steps (after Accept)

Workflow is finished; no further owflow phase command is required. All follow-ups are `optional` (post-completion quality work, none advance phases):

- `/owflow:reviews-pragmatic <task-path>` — `optional` — post-completion over-engineering / pragmatism check; does not advance phases
- `/owflow:standards-update "<lesson learned>"` — `optional` — captures any new patterns as project standards; does not advance phases

**Other options**: commit the changes using the provided message template; open a PR. (Manual steps outside owflow.)

Then STOP.
