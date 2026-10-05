---
name: owflow:goal-migration
description: Full orchestrated migration wrapper — runs ALL migration steps in one session by invoking every migration-* subskill in sequence with question gates between them. Use /owflow:migration for the same lifecycle in assisted mode — tasks can mix both modes freely.
argument-hint: "[task description | task-path] [--from=<slug>] [--type=TYPE] [--no-web-research]"
user-invocable: true
---

# Orchestrated Migration Wrapper

Autonomous mode for migration tasks. Initializes (or resumes) the task, then invokes every required `migration-*` subskill back-to-back via the Skill tool, pausing at gates between subskills. Shares `orchestrator-state.yml` with assisted mode (`/owflow:migration`) — tasks can mix both modes freely. There is no migration quick lane.

Gates follow the shared contract in [Gate Contract](../orchestrator-framework/references/gate-contract.md) — orchestrated mode exception: each subskill's own Exit Gate acceptance question IS the loop gate (Accept = continue to the next subskill).

## Input / Output Artifacts

| Artifact                             | Behavior (this wrapper)                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Consumed: argument (description / path) | migration description (new task) or task path/identifier (resume)                           |
| Consumed/produced: all task artifacts | owned entirely by the invoked subskills (none here — delegate, never inline)                  |
| State write                           | `orchestrator.task_ids` (task items) + `orchestrator.updated` only; first-time initialization per the dispatcher's Step 3 is the one permitted write outside the loop |

## Entry Gate

Identical to the migration dispatcher — complete ALL of its entry-gate steps first (see `../migration/SKILL.md` Entry Gate):

1. Read the framework reference files NOW, exactly as the migration dispatcher's Step 1: the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md), the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), and the [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md).
2. Resolve the argument the same way the migration dispatcher does: task path or identifier (a directory, or a directory name under `.owflow/tasks/migrations/`) → **resume mode** (read `orchestrator-state.yml`, artifact-validate `completed_phases` against the dispatcher's marker table; find the first step slug NOT in `completed_phases` whose condition holds, with `--from=<slug>` overriding after prerequisite validation); a migration description (free text) → new task; nothing provided → ask via `question` — "What technology, platform, or architecture should be migrated, and to what?" — then WAIT. Missing state file → print `No migration task found at <path>. Run /owflow:migration <description> to start a migration task from scratch.` and STOP.
3. Initialize (new task) exactly as the dispatcher's Step 3: create `.owflow/tasks/migrations/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the migration template — `task.title` / `task.description` from the description, `task.status: in_progress`, `orchestrator.started_phase: state-analysed`, `orchestrator.entry_point: "migration"`, `orchestrator.task_path`, flags recorded (`--type` → `migration_context.migration_type`; `--no-web-research` is forwarded to `migration-target` per invocation — nothing is persisted for it). **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-migration.yml`. First-time initialization is the one permitted write outside the loop.
4. Create ONE task item via `TaskCreate` per subskill in the upcoming loop (subject: `"<step name>: <subskill>"`, e.g. `"Spec: migration-spec"`), then set the execution order with `TaskUpdate addBlockedBy` (analyze → target → spec → plan → implement → verify → fix → finalize). Record the ids in `orchestrator.task_ids`. On resume, refresh the already-evidenced items instead of re-creating them. Update statuses as the loop progresses.

**Output**:

```
🚀 Orchestrated Migration

Task: [migration description]
Directory: [task-path]
Loop: migration-analyze → migration-target → migration-spec → migration-plan → migration-implement → migration-verify → [migration-fix] → migration-finalize
```

---

## The Loop

For each subskill in sequence, execute — skipping any row whose condition is not met (a row whose slug is already in `completed_phases` counts as done). **Compatibility re-verification fallback**: when the loop finds no runnable row and `verification-done` is complete with `verification_context.compatibility_status != passed` (failed or null/invalidated), invoke `migration-verify` once (re-verification, overriding slug completeness), then re-read state and continue from the first row whose condition holds; it does not re-fire while the Fix row is runnable; a recorded data-integrity HALT keeps the user-confirmed rollback path dominant.

1. **Announce**: 1-line step banner.
2. **Invoke**: Skill tool with `name: "owflow:<subskill>"` and `prompt: "<task-path> [flags relevant to that subskill]"`. The subskill owns its Entry Gate, delegation, and state updates. Flags forwarded per subskill: `--type` and `--no-web-research` to `migration-target`.
3. **Verify handback**: after the skill returns, re-read `orchestrator-state.yml` — confirm the expected step slug(s) were appended to `completed_phases` per the Sequence and Conditionals table. If a subskill stopped early (its Entry Gate failed), STOP the loop and relay its routing message to the user verbatim.
4. **Gate (subskill's Exit Gate is the loop gate)**: each subskill presents its results box and fires its own results-acceptance `question` before its handoff hint (Orchestrated-mode exception, [Gate Contract](../orchestrator-framework/references/gate-contract.md)). [Rule 5 of the Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) — "subskills only SUGGEST the next command" — is superseded for Accept: when the user answers **Accept** to the subskill's Exit Gate question pointing at the next subskill in this loop, treat that as "continue to the next subskill" and invoke it. Any other answer (Adjust / Discuss / Stop / other options picked) ends the loop: print the standard handoff block (next command + `/owflow:migration <task-path>` resume hint) and end.
   - **Non-loop-gate questions**: the in-phase questions inside subskills (analyze clarifiers, spec requirement questions, verify's options step, fix's per-iteration questions) are part of that subskill's own decision flow — they are NOT the loop gate and are NEVER auto-accepted or answered by this wrapper. There is exactly ONE gate definition per subskill hop; the wrapper adds NO second consecutive `question`.
   - **No quick lane**: migration has no quick lane — every row runs at full fidelity.

### Sequence and Conditionals

| Order | Subskill           | Run when (re-read from state)                                                                                          |
| ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | migration-analyze  | Always (new task or partial foundation)                                                                                  |
| 2     | migration-target   | `state-analysed` in `completed_phases`                                                                                  |
| 3     | migration-spec     | `target-planned` completed                                                                                              |
| 4     | migration-plan     | `strategy-specified` completed                                                                                          |
| 5     | migration-implement | `plan-created` completed                                                                                               |
| 6     | migration-verify   | `migration-executed` completed                                                                                          |
| 7     | migration-fix      | `verification-done` completed **and** (`verification_context.compatibility_status = failed` **or** (`verification_context.last_status != passed` **and** no recorded deliberate skip)); otherwise the row is skipped and `migration-finalize`'s own Entry Gate routes forward |
| 8     | migration-finalize | `verification-done` completed **and** `verification_context.compatibility_status = passed` **and** the fix phase is settled (`issues-resolved` present, or `last_status = passed`, or a recorded deliberate skip) |

`task-completed` already in `completed_phases` → the task is TERMINAL: skip the loop and present the wrapper Exit Gate.

**Interruptible**: at any gate the user may answer "stop" — print the standard handoff block (next command + `/owflow:migration <task-path>` resume hint) and end the session. The task resumes later in either mode; a fresh invocation of this wrapper resumes from state, never from loop memory.

---

## Exit Gate

When migration-finalize completes (`task.status: completed`):

1. Mark the final task item completed via `TaskUpdate`.
2. Present the workflow results box:

```markdown
## ✅ MIGRATION WORKFLOW COMPLETE — <task name>

**Migration** — [current → target, type]
**Strategy** — [incremental / big-bang / dual-run / phased]
**Steps** — [executed step slugs, e.g. state-analysed → target-planned → strategy-specified → plan-created → migration-executed → options-chosen → verification-done → issues-resolved → docs-generated → task-completed]
**Verification** — [final verifier verdict + overall compatibility verdict]
**Fixes** — [N applied / none required / deliberately skipped]
**Operator guide** — [generated / skipped (`docs_enabled` not enabled)]

**Artifacts** — [artifact inventory: `analysis/current-state-analysis.md`, `analysis/target-state-plan.md`, `analysis/requirements.md`, `analysis/rollback-plan.md`, `implementation/spec.md`, `implementation/implementation-plan.md`, `implementation/work-log.md`, `verification/implementation-verification.md`, `verification/compatibility-test-results.md`, `documentation/migration-guide.md` (conditional)]
```

3. Use `question` — "Are these results correct?" with options: **Accept** (print follow-up suggestions: review the artifacts, commit personally — the workflow performs no commits; `/owflow:reviews-pragmatic <task-path>` if desired; then end) / **Adjust** (re-open the relevant `/owflow:migration-*` skill with the corrections) / **Discuss** (walk through the migration summary) / **Stop here** (print the resume command `/owflow:migration <task-path>` and end).

Then end. No further owflow phase commands are required.

---

## Loop Rules

- **Delegate, never inline**: the wrapper only sequences — all step work happens inside subskills. If you catch yourself analyzing/migrating outside a subskill, STOP and invoke the subskill instead.
- **State is the truth**: gates and routing read `orchestrator-state.yml`, not memory. Re-read after every subskill returns.
- **Same state schema as assisted mode**: `completed_phases` step slugs (`state-analysed` … `task-completed`) are identical; resume works across modes.
- **Wrapper writes almost nothing**: step slugs, summaries, and outputs belong to the subskills — this wrapper writes ONLY `orchestrator.task_ids` (task items) and `orchestrator.updated` (timestamps); the sole exception is first-time initialization per the dispatcher's Step 3.
- **Zero added pause points**: one full pass asks at most the 8 subskill Exit Gates + this terminal gate = 9 — fewer when the conditional `migration-fix` row is skipped; the same asks as assisted mode. There is no per-hop back-to-back `question` exception: the wrapper adds no question inside the loop, and its only wrapper-level `question` is this terminal gate (the finalize gate and the wrapper gate are the one legitimate consecutive pair).

## Command Integration

Invoked via:

- `/owflow:goal-migration [description] [--type=TYPE] [--no-web-research]` (new)
- `/owflow:goal-migration [task-path] [--from=<slug>]` (resume)

Alternative: `/owflow:migration` — same task in assisted mode (one subskill per invocation, fresh context each step).
