---
name: owflow:migration
description: Migration workflow dispatcher. Initializes/resumes migration tasks, derives the next step from state, and hands off to the matching /owflow:migration-* subskill. Handles technology migrations, platform changes, and architecture pattern transitions with adaptive risk assessment, incremental execution, rollback planning, dual-run support, and compatibility verification.
argument-hint: "[task description | task-path] [--from=<slug>] [--type=TYPE] [--no-web-research]"
user-invocable: true
---

# Migration Dispatcher

Entry point for migration tasks in **assisted mode**: initialize (or resume) the task, derive the next pending step from `orchestrator-state.yml`, print the matching subskill command, and STOP. Each `/owflow:migration-*` subskill runs its steps with fresh context — the explicit invocation IS the step gate.

Migration state uses descriptive step slugs in `completed_phases` / `failed_phases` / `auto_fix_attempts`: `state-analysed`, `target-planned`, `strategy-specified`, `plan-created`, `migration-executed`, `options-chosen`, `verification-done`, `issues-resolved`, `docs-generated`, `task-completed`. The routing table below maps slugs to subskills.

For the all-in-one loop with in-session `question` gates, use `/owflow:goal-migration`.

Gates follow the shared contract in the [Gate Contract](../orchestrator-framework/references/gate-contract.md), with the [dispatcher exception](../orchestrator-framework/references/gate-contract.md).

## Input / Output Artifacts

| Artifact                              | Behavior                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Argument (description / task path)     | migration description (new task) or task path/identifier (resume); nothing provided → ask |
| `orchestrator-state.yml`               | read on resume — artifact-validated against the marker table below                        |
| Task directory + state initialization  | written once (Step 3, new task) — `entry_point: "migration"`, flags recorded              |
| Slugs, artifacts, and step bodies      | none — every task artifact is produced by the subskills (see [Task Structure](#task-structure)) |

The dispatcher writes nothing else — it owns 0 slugs and contains no step bodies.

## Entry Gate

**BEFORE deriving the handoff, complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference files NOW using the Read tool:**

1. The [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) governs this skill.
2. The [Delegation Rules](../orchestrator-framework/references/delegation-rules.md) bound what subskills delegate.
3. The [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md) define state schema, initialization, and context passing.

### Step 2: Resolve the Argument

**If the argument is a task path or identifier** (a directory, or a directory name under `.owflow/tasks/migrations/`) → **resume mode**:

1. Read `orchestrator-state.yml`; artifact-validate `completed_phases` against the marker table below — **drop** any slug whose marker is missing, **adopt** any marker whose slug is missing (append the slug, backfill still-null fields it proves were produced).
2. Find the resume point: the FIRST step slug not in `completed_phases` whose routing-table condition holds. **Compatibility re-verification fallback**: if **no routing-table step applies** and `verification-done` is complete and `verification_context.compatibility_status != passed` (failed or null/invalidated), the resume point is `/owflow:migration-verify <task-path>` (re-verification — the 4 checks re-run and the verdict is settled), overriding slug completeness; a recorded data-integrity HALT keeps the user-confirmed rollback path dominant. `--from=<slug>` overrides, but only after validating that slug's prerequisites (the upstream slug **and** marker artifacts) exist **and** its row's state facts hold (e.g. no Finalize jump while `compatibility_status != passed`) — otherwise use `question`, never a silent jump.
3. Missing state file → print: `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.

**If the argument is a migration description** (any other free text) → new task.

**If nothing is provided** → ask via `question`: "What technology, platform, or architecture should be migrated, and to what?" — capture source and target state, then WAIT. Never guess or auto-pick a task.

#### Marker table (artifact-validated resume)

| Slug                 | Marker artifact / state fact                                 |
| -------------------- | ------------------------------------------------------------ |
| `state-analysed`     | `analysis/current-state-analysis.md` **and** `analysis/clarifications.md` |
| `target-planned`     | `analysis/target-state-plan.md`                              |
| `strategy-specified` | `implementation/spec.md`                                     |
| `plan-created`       | `implementation/implementation-plan.md`                      |
| `migration-executed` | `implementation/work-log.md`                                 |
| `options-chosen`     | settled `options.*` values (state-resident — no artifact)     |
| `verification-done`  | `verification/implementation-verification.md` + `verification/compatibility-test-results.md` **and** non-null `verification_context.compatibility_status` |
| `issues-resolved`    | non-empty `verification_context.fixes_applied` **or** a recorded approval in `verification_context.decisions_made` (state-resident — no artifact) |
| `docs-generated`     | `documentation/migration-guide.md`                           |
| `task-completed`     | `task.status: completed` (state-resident — no artifact)      |

A settled options value, a completed fix phase (non-empty `fixes_applied` or a recorded approval/deliberate skip), or a `--from` decision is not re-asked on resume: report the existing decision and route from it.

### Step 3: Initialize (new task)

1. **Create Task Directory**: `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` (3–5 kebab-case words from the description)
2. **Initialize State**: create `orchestrator-state.yml` from the migration template.
   - `task.title` / `task.description` from the description; `task.status: in_progress`; `task.tags: []`; `task.priority: null` (template defaults)
   - `orchestrator.started_phase: state-analysed`; `orchestrator.entry_point: "migration"`; `orchestrator.task_path`; `orchestrator.created` / `orchestrator.updated`
   - Flags: `--type=code|data|architecture|general` → `migration_context.migration_type` (a **default, not an override** — `migration-target` still confirms on low confidence); `--no-web-research` is a per-subskill flag forwarded to `migration-target` (skips external research; `migration-target` records `external_research.performed: false`) — nothing is persisted for it at init
   - **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-migration.yml`.
3. **Create Task Items**: use `TaskCreate` for the migration steps (one item per subskill handoff: analyze → target → spec → plan → implement → verify → fix → finalize), then set the execution order with `TaskUpdate addBlockedBy`. Record the ids in `orchestrator.task_ids`. On resume, refresh the already-evidenced items instead of re-creating them.
4. No project-documentation discovery at this layer — `migration-spec` reads `.owflow/docs/INDEX.md` when it gathers requirements (nothing is persisted to a `project_context` key).

**Output**:

```
🚀 Migration Dispatcher

Task: [migration description]
Directory: [task-path]
Next step: [step name]
```

---

## When to Use

Use when:

- Migrating from one framework/library to another (e.g., Vue 2 → Vue 3, Express → Fastify)
- Changing database platforms (e.g., MySQL → PostgreSQL, MongoDB → DynamoDB)
- Refactoring architecture patterns (e.g., REST → GraphQL, Monolith → Microservices)
- Upgrading major versions with breaking changes

**DO NOT use for**: New features, bug fixes, pure refactoring without technology change.

---

## Core Principles

1. **Analyze Before Migrating**: Understand current system before planning target state
2. **Risk Assessment**: Classify migration type (code/data/architecture) and assess complexity
3. **Incremental Execution**: Support phased migration with rollback points
4. **Rollback Planning**: Document undo procedures for each migration phase
5. **Dual-Run Support**: Enable running old and new systems in parallel during transition

---

## Migration Types

| Type             | Keywords                             | Strategy                 | Risk Focus                        |
| ---------------- | ------------------------------------ | ------------------------ | --------------------------------- |
| **Code**         | framework, library, upgrade          | Incremental or phased    | Breaking changes, API differences |
| **Data**         | database, schema, data migration     | Dual-run (zero downtime) | Data integrity, checksums         |
| **Architecture** | REST→GraphQL, monolith→microservices | Dual-run or phased       | Compatibility, rollback           |

The type-detection algorithm (with confidence scoring), per-type adaptations, and the external-research requirement table live in `migration-target/references/migration-types.md` — read there, not here.

---

## Routing Table (completed_phases → next subskill)

Derive the FIRST step slug not in `completed_phases` whose condition holds, then print the matching command:

| Next step (slugs)                                | Condition (from state)                                                                                                         | Handoff command                        | Produces                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Analyze (`state-analysed`)                       | Always (new task or partial foundation)                                                                                        | `/owflow:migration-analyze <task-path>` | `analysis/current-state-analysis.md`, `analysis/clarifications.md`                                 |
| Target (`target-planned`)                        | `state-analysed` completed                                                                                                     | `/owflow:migration-target <task-path>`  | `analysis/target-state-plan.md` (type/strategy locked by the risk gate)                            |
| Spec (`strategy-specified`)                      | `target-planned` completed                                                                                                     | `/owflow:migration-spec <task-path>`    | `analysis/requirements.md`, `implementation/spec.md`, `analysis/rollback-plan.md` (+ `analysis/dual-run-plan.md` when dual-run applies) |
| Plan (`plan-created`)                            | `strategy-specified` completed                                                                                                 | `/owflow:migration-plan <task-path>`    | `implementation/implementation-plan.md` with per-group rollback/checkpoint steps                   |
| Implement (`migration-executed`)                 | `plan-created` completed                                                                                                       | `/owflow:migration-implement <task-path>` | implemented migration changes, `implementation/work-log.md`                                       |
| Verify (`options-chosen`, `verification-done`)   | `migration-executed` completed                                                                                                 | `/owflow:migration-verify <task-path>`  | `verification/implementation-verification.md`, `verification/compatibility-test-results.md`        |
| Fix (`issues-resolved`)                          | `verification-done` completed **and** (`verification_context.compatibility_status = failed` **or** (`verification_context.last_status != passed` **and** no recorded deliberate skip)) | `/owflow:migration-fix <task-path>`     | fixes + updated `verification/implementation-verification.md`; data-integrity HALT stays with the user |
| Finalize (`docs-generated`, `task-completed`)    | `verification-done` completed **and** `verification_context.compatibility_status = passed` **and** the fix phase is settled (`issues-resolved` present, or `last_status = passed`, or a recorded deliberate skip) | `/owflow:migration-finalize <task-path>` | `documentation/migration-guide.md` (when `options.docs_enabled` is true), `task.status: completed` |

Notes:

- Each row's condition is re-read from state, never inferred: the Fix row activates on a failed compatibility check unconditionally, or on verifier issues without a recorded deliberate skip; the Finalize row requires `compatibility_status = passed` **and** a settled fix phase — a failed compatibility check is never waived by a skip or approval, so `task-completed` cannot be reached over one.
- **Compatibility re-verification fallback**: when no routing-table row applies **and** `verification-done` ∈ `completed_phases` **and** `compatibility_status != passed`, hand off to `/owflow:migration-verify <task-path>` (the re-verification re-runs the 4 checks and settles the verdict). The Fix row stays primary whenever its condition holds — an ordinary pre-fix failure routes to `/owflow:migration-fix`, never to a redundant check re-run; a recorded data-integrity HALT keeps the user-confirmed rollback path dominant.
- `task-completed` already in `completed_phases` → the task is TERMINAL: no handoff.
- Slugs that are already in `completed_phases` but whose marker artifact is missing are dropped during Step 2 — never trust a bare slug.

---

## Exit Gate (adapted for dispatch mode)

After deriving the handoff, present the results box, ask how to proceed, then hand off accordingly (see the [dispatcher exception](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the subskill.

### Results box

```markdown
## ✅ MIGRATION TASK READY — <task name>

**Task** — [migration description]
**Directory** — `<task-path>`
**Next step** — [step name]
[Resume note: completed steps / fresh task]

**Next ▸** `/owflow:migration-<subskill> <task-path>`
```

For a terminal task (`task-completed` recorded), the results box reports the workflow as complete and carries no **Next ▸** handoff line.

### Acceptance question

Use `question` — "Task ready. How would you like to proceed?" with options:

- **Hand off to /owflow:migration-<subskill>** — the user invokes the suggested command (the dispatcher copies it to chat for convenience). Execution starts in a fresh context.
- **Switch to autonomous mode** — illustrate with `/owflow:goal-migration <task-path>` to run remaining steps in one session with gates.
- **Adjust** — task set-up is wrong (wrong flags, wrong description, wrong task); re-run the affected initialization step, re-present the results box.
- **Stop here** — print the resume command (`/owflow:migration <task-path>`) and end.

For a terminal task, omit the first option (there is nothing to hand off) and report the completed workflow.

### Handoff message

On Accept (hand off choice), print, then STOP:

```
✓ Migration task ready at <task-path>

Next step:
  → /owflow:migration-<subskill> <task-path>

Other options:
  /owflow:goal-migration <task-path>   — run remaining steps in one loop
  /owflow:migration --from=<slug> <task-path>   — jump to a specific step
```

---

## Task Structure

```
.owflow/tasks/migrations/YYYY-MM-DD-migration-name/
├── orchestrator-state.yml
├── analysis/
│   ├── current-state-analysis.md     # migration-analyze
│   ├── clarifications.md             # migration-analyze
│   ├── target-state-plan.md          # migration-target
│   ├── requirements.md               # migration-spec
│   ├── rollback-plan.md              # migration-spec
│   └── dual-run-plan.md              # migration-spec (if dual-run)
├── implementation/
│   ├── spec.md                       # migration-spec
│   ├── implementation-plan.md        # migration-plan
│   └── work-log.md                   # migration-implement
├── verification/
│   ├── implementation-verification.md    # migration-verify
│   └── compatibility-test-results.md     # migration-verify
└── documentation/
    └── migration-guide.md            # migration-finalize (optional)
```

---

## Domain Context (State Extensions)

Migration-specific fields in `orchestrator-state.yml`: refer to the template [src/templates/orchestrator-state-migration.yml](../../templates/orchestrator-state-migration.yml).

---

## Auto-Recovery

Retries are owned by each subskill (max attempts per step):

| Subskill            | Max Attempts | Strategy                                                                          |
| ------------------- | ------------ | --------------------------------------------------------------------------------- |
| migration-analyze   | 2            | Expand search patterns, prompt the user for file paths                            |
| migration-target    | 2            | Re-prompt for target details                                                      |
| migration-spec      | 2            | Re-gather requirements, re-invoke spec-creator, regenerate rollback plan          |
| migration-plan      | 2            | Regenerate with migration constraints                                             |
| migration-implement | 5            | Fix syntax errors, prompt user on repeated failure                                |
| migration-verify    | 3            | Fix-then-reverify. **HALT on data integrity issues**                              |
| migration-fix       | 3 iterations | Contract, not a retry counter; data-integrity HALT is never auto-fixed            |
| migration-finalize  | 1            | Generate the operator guide text-only; state-only completion                      |

---

## Command Flags

Flags are restated here because `argument-hint` is not registered in the command object.

| Flag                              | Effect                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--from=<slug>`                   | Hand off (resume mode) from a specific step slug; prerequisites are validated, otherwise `question`          |
| `--type=code\|data\|architecture\|general` | Default classification → `migration_context.migration_type` (not an override — low confidence still confirms) |
| `--no-web-research`               | Forwarded to `migration-target`: skips external research and records `external_research.performed: false` (no state key is written at init — the flag is per-invocation) |

---

## Command Integration

Invoked via:

- `/owflow:migration [description] [--type=TYPE] [--no-web-research]` (new)
- `/owflow:migration [task-path] [--from=<slug>]` (resume)

Alternative: `/owflow:goal-migration` — same task lifecycle, all subskills invoked in one session with `question` gates.

Task directory: `.owflow/tasks/migrations/YYYY-MM-DD-task-name/`
