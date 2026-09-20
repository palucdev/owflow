---
name: owflow:dev-finalize
description: Development — conditional E2E testing, user documentation, and workflow finalization with commit guidance.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Finalize — Phases 11–13 (E2E, User Docs & Finalization)

Closing phase of the development workflow. Runs optional E2E browser verification and user documentation when enabled, then finalizes the workflow.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Phases 1–2 (codebase & gap analysis) → `/owflow:dev-analyze <task-path>`
     - Phase 3 (TDD red gate) — only when a reproducible defect was detected → `/owflow:dev-tdd-red <task-path>`
     - Phases 4–5 (requirements, specification & audit) → `/owflow:dev-spec <task-path>`
     - Phase 6 (implementation planning) → `/owflow:dev-plan <task-path>`
     - Phases 7–8 (implementation & TDD green gate) → `/owflow:dev-implement <task-path>`
     - Phases 9–10 (verification & issue resolution) → `/owflow:dev-verify <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                            | Produced by                        |
| ----------------------- | ----------------------------------------- | ---------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`      | `/owflow:development <desc>`       |
| Verification done       | `phase-10` in `completed_phases`          | `/owflow:dev-verify <task-path>`   |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Prerequisite check**: `phase-10` in `completed_phases`. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: Phases 1–2 (analysis) → Phase 3 (TDD red gate, only when a reproducible defect was detected) → Phases 4–5 (specification) → Phase 6 (implementation planning) → Phases 7–8 (implementation) → Phases 9–10 (verification).
   - `Run /owflow:dev-verify <task-path> first` (or the command for the earliest missing earlier step).
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`
3. **Skip/resume**: if `task.status` is `completed`, report the existing finalization and STOP.
4. **Conditional activation**: if `options.e2e_enabled: false` and `options.user_docs_enabled: false`, skip to Phase 13 (Finalization).

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Phase 11 — E2E Testing (conditional)

**Skip if** `options.e2e_enabled: false`.

Task tool - `e2e-test-verifier`. Prompt MUST include: task_path (absolute), spec_path (`implementation/spec.md`), base_url. Report saves to `{task_path}/verification/e2e-verification-report.md` with screenshots. This is runtime browser verification via Playwright MCP tools — not test file generation.

### Phase 12 — User Documentation (conditional)

**Skip if** `options.user_docs_enabled: false`.

Task tool - `user-docs-generator`. Prompt MUST include: task_path (absolute), spec_path, base_url. Guide saves to `{task_path}/documentation/user-guide.md` with screenshots.

### Phase 13 — Finalization (inline)

1. Create workflow summary: what was built, phases executed, verification outcome, artifacts produced.
2. Update `task.status: completed` in state.
3. Provide commit message template (conventional style, referencing task name).
4. Guide next steps: code review, PR, deployment.

## State Update Convention (per step)

Apply after EVERY phase above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the phase completes, appending ONLY the `phase-N` entry actually performed plus that step's fields. Never batch multiple phases into one end-of-skill write:
   - After Phase 11 (only when E2E ran): append `phase-11` to `completed_phases`; record the E2E verdict; bump `orchestrator.updated`.
   - After Phase 12 (only when user docs ran): append `phase-12` to `completed_phases`; record the guide location; bump `orchestrator.updated`.
   - After Phase 13: append `phase-13` to `completed_phases`; set `task.status: completed`; bump `orchestrator.updated`.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the E2E run or documentation generation fails and cannot be recovered, do NOT append the corresponding `phase-N` to `completed_phases`; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-N"]`. Ask the user whether to retry or continue to finalization without that phase.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then close the workflow (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```
═══════════════════════════════════════════════════════
  DEVELOPMENT WORKFLOW COMPLETE: <task name>
═══════════════════════════════════════════════════════
  Built:          [1-2 line summary of what was built]
  Phases:         [executed phases, e.g. 1-2, 4-13]
  Verification:   [final verification outcome]
  E2E verdict:    [if run] / skipped
  User guide:     [path] / not generated

  Artifacts:
    - verification/e2e-verification-report.md   [conditional]
    - documentation/user-guide.md               [conditional]
═══════════════════════════════════════════════════════
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — workflow is complete; show closing guidance.
- **Adjust** — re-run the affected optional phase (E2E or user docs) with the user's corrections, then re-present the results box.
- **Discuss** — walk through the finalization (summary, E2E verdict, guide contents, commit guidance) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-finalize <task-path>`) and end.

### Next steps (after Accept)

Workflow is finished; no further owflow phase command is required. Suggested follow-ups:

- `/owflow:reviews-pragmatic <task-path>` — post-completion over-engineering check
- `/owflow:standards-update "<lesson learned>"` — capture any new patterns as standards

**Other options**: commit the changes using the provided message template; open a PR.

Then STOP.
