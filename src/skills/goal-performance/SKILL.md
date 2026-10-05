---
name: owflow:goal-performance
description: Full orchestrated performance wrapper — runs ALL performance steps in one session by invoking every performance-* subskill in sequence with question gates between them. Use /owflow:performance for the same lifecycle in assisted mode — tasks can mix both modes freely.
argument-hint: "[task description | task-path] [--from=<step-slug>]"
user-invocable: true
---

# Orchestrated Performance Wrapper

Autonomous mode for performance tasks. Initializes (or resumes) the task, then invokes every required `performance-*` subskill back-to-back via the Skill tool, pausing at gates between subskills. Shares `orchestrator-state.yml` with assisted mode (`/owflow:performance`) — tasks can mix both modes freely.

Gates follow the shared contract in [Gate Contract](../orchestrator-framework/references/gate-contract.md) — orchestrated mode exception: each subskill's own Exit Gate acceptance question IS the loop gate (Accept = continue to the next subskill). **At intermediate hops the wrapper MUST NOT add a second consecutive `question`**; after the final hop, the wrapper Exit Gate below fires exactly one workflow-closure confirmation.

## Input / Output Artifacts

| Artifact | This wrapper | Assisted mode (`/owflow:performance`) |
| --- | --- | --- |
| Consumed: argument (description / path) | performance issue description (new task) or task path/identifier (resume) | same |
| Consumed/produced: all task artifacts | owned entirely by the invoked subskills (none here — delegate, never inline) | same |
| State write | init as the dispatcher; during the loop ONLY `orchestrator.task_ids` + `orchestrator.updated` | init + drop-only resume trim |

## Entry Gate

Identical to the performance dispatcher — complete ALL of its entry-gate steps first (see `../performance/SKILL.md` Entry Gate):

1. Read the framework reference files NOW, exactly as the performance dispatcher's Step 1: the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md), the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), and the [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md).
2. Resolve the argument the same way the performance dispatcher does: task path or identifier (a directory, or a directory name under `.owflow/tasks/performance/`) → **resume mode** (read `orchestrator-state.yml`, run the dispatcher's drop-only resume validation, derive the next step from the dispatcher's routing table, with `--from=<step-slug>` overriding); a performance issue description (free text) → new task; nothing provided → ask via `question` — "What is slow or performance-constrained? Describe the symptom (endpoint, page, job), expected vs actual behavior, and any profiling data you have." — then WAIT. Missing state file → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
3. Initialize (new task) exactly as the dispatcher: create `.owflow/tasks/performance/YYYY-MM-DD-task-name/` with `analysis/`, `analysis/user-profiling-data/`, `implementation/`, `verification/`, then `orchestrator-state.yml` from the performance template — `task.title` / `task.description` from the description, `task.status: in_progress`, `orchestrator.task_path`, `orchestrator.entry_point: "performance"`, and project docs into `performance_context.project_doc_paths`. **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-performance.yml`.
4. Create the six task items via `TaskCreate` exactly as the dispatcher does (one per subskill), set `addBlockedBy` chains, and record their ids in `orchestrator.task_ids`. On resume, refresh the already-evidenced items instead of re-creating them. Update item statuses as the loop progresses.

**Output**:

```
🚀 Orchestrated Performance

Task: [performance issue description]
Directory: [task-path]
Loop: performance-analyze → performance-spec → performance-plan → performance-implement → performance-verify → performance-finalize
```

---

## The Loop

For each subskill in the Sequence table below, execute — skipping any row whose **Runs when** condition is not met. The condition is authoritative: a multi-slug row (row 2) still runs when one of its slugs is complete but the other is pending (the audit re-entry case).

1. **Announce**: 1-line step banner.
2. **Invoke**: Skill tool with `name: "<subskill>"` and `prompt: "<task-path> [flags relevant to that subskill]"`. The subskill owns its Entry Gate, delegation, and state updates. Never run a subskill's or an agent's work inline.
3. **Verify handback**: after the skill returns, re-read `orchestrator-state.yml` — confirm the row's expected slug(s) are present in `completed_phases`. A re-entered row may add only its pending slug, and an audit skip records `options.spec_audit_enabled: false` with no new slug — those are legitimate completions, not early stops. A subskill that stopped at its entry check (missing prerequisites, no task) ENDS the loop and its routing/blocked message is relayed to the user.
4. **Gate (the subskill's Exit Gate IS the loop gate)**: each subskill presents its results box and fires its own results-acceptance `question` before its handoff hint (orchestrated-mode exception, [Gate Contract](../orchestrator-framework/references/gate-contract.md)). When the user answers **Accept**, treat it as "continue to the next subskill" and invoke it. Any other answer (Adjust / Discuss / Stop here) ends the loop exactly like a rejected gate. There is exactly ONE gate per hop — **the wrapper adds NO second consecutive `question` at intermediate hops**; the terminal wrapper Exit Gate (below) is the single workflow-closure confirmation after the final hop.

### Sequence

| Order | Subskill | Runs when (from state) | Slugs verified after |
| --- | --- | --- | --- |
| 1 | `performance-analyze` | new task, OR `codebase-analysed` absent, OR (`codebase-analysed` present AND `bottlenecks-identified` absent) | `codebase-analysed`, `bottlenecks-identified` |
| 2 | `performance-spec` | `bottlenecks-identified` complete AND [ (`spec-written` absent) OR (`spec-audited` absent AND (`options.spec_audit_enabled` is null OR `true`)) ] | `spec-written` (+ `spec-audited` when the audit ran) |
| 3 | `performance-plan` | `spec-written` complete AND `options.spec_audit_enabled` non-null — settled, NEVER `spec-audited` — AND `plan-created` absent | `plan-created` |
| 4 | `performance-implement` | `plan-created` complete AND `implementation-done` absent | `implementation-done` |
| 5 | `performance-verify` | `implementation-done` complete AND [ `options-chosen` absent OR `verification-done` absent ] | `options-chosen`, `verification-done` |
| 6 | `performance-finalize` | `verification-done` complete AND `task-completed` absent | `task-completed` + `task.status: completed` |

Six rows, ZERO user-choice rows: every performance conditional is an in-skill `question` owned by a subskill, never a chain decision this wrapper makes.

### Decisions the wrapper never answers

The six in-skill decision questions below belong to the subskill that owns them — they are NEVER auto-accepted, pre-answered, or skipped by this wrapper (decisions are never silently accepted):

| Subskill | In-skill decision questions |
| --- | --- |
| `performance-analyze` | performance concerns / hotspots / goals (max 5); profiling-data offer |
| `performance-spec` | bottleneck priorities / constraints / targets; run the specification audit? |
| `performance-verify` | which additional verification checks; fix-set selection + re-run verification |

`performance-plan`, `performance-implement`, and `performance-finalize` have no in-skill decision questions — their only gates are their Exit Gates (the loop gate above).

**Interruptible**: at any gate the user may answer "stop" — print the standard handoff block (`/owflow:performance <task-path>` resume hint + the next command) and end the session. The task resumes later in either mode.

`task-completed` already in `completed_phases` (with `task.status: completed`) → the task is TERMINAL: skip the Loop and present the wrapper Exit Gate.

---

## Exit Gate

When `performance-finalize`'s own Exit Gate is accepted (`task-completed` recorded, `task.status: completed`):

1. Mark the final task item completed via `TaskUpdate`.
2. Present the wrapper terminal results box:

```markdown
## ✅ PERFORMANCE WORKFLOW COMPLETE — <task name>

**Steps** — [executed step slugs, e.g. codebase-analysed → bottlenecks-identified → … → task-completed]
**Bottlenecks found** — [P0/P1/P2/P3 counts]
**Optimizations applied** — [count + key ones]
**Verification** — [final verdict]
**Estimated improvement** — [range from the analysis]

**Artifacts**

- `analysis/performance-analysis.md`
- `implementation/work-log.md`
- `verification/implementation-verification.md`
```

3. Use `question` — "Are these results correct?" with options: **Accept** (print the follow-up suggestions: measure the improvement, consider runtime profiling, `/owflow:standards-update "<lesson>"`, then end) / **Adjust** (re-open the affected `/owflow:performance-*` skill with the corrections) / **Discuss** (walk through the optimization summary, evidence, and measurement caveats) / **Stop here** (print the resume command `/owflow:performance <task-path>` and end).

Then end. No further owflow commands are required.

---

## Loop Rules

- **Delegate, never inline**: the wrapper only sequences — all step work happens inside subskills. If you catch yourself analyzing or implementing outside a subskill, STOP and invoke the subskill instead.
- **State is the truth**: gates and routing read `orchestrator-state.yml`, not memory. Re-read after every subskill returns.
- **Same state schema as assisted mode**: `completed_phases` step slugs (`codebase-analysed` … `task-completed`) are identical; resume works across modes.
- **Wrapper writes almost nothing**: step slugs, summaries, and artifacts belong to the subskills — during the loop this wrapper writes ONLY `orchestrator.task_ids` (task items) and `orchestrator.updated` (timestamps).

## Command Integration

Invoked via:

- `/owflow:goal-performance [description]` (new)
- `/owflow:goal-performance [task-path] [--from=<step-slug>]` (resume)

Alternative: `/owflow:performance` — same task in assisted mode (one subskill per invocation, fresh context each step).
