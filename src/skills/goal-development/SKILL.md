---
name: goal-development
description: Full orchestrated development wrapper — runs ALL development phases in one session by invoking every dev-* subskill in sequence with question gates between them. Equivalent to the classic unified orchestrator.
argument-hint: "[task description | task-path] [--from=PHASE] [--research=PATH] [--e2e] [--user-docs]"
user-invocable: true
---

# Orchestrated Development Wrapper

Loop mode for development tasks. Initializes (or resumes) the task, then invokes every required `dev-*` subskill back-to-back via the Skill tool, pausing at gates between subskills. Shares `orchestrator-state.yml` with handoff mode (`/owflow:development`) — tasks can mix both modes freely.

Gates follow the shared contract in `../orchestrator-framework/references/orchestrator-patterns.md` Section 9 — orchestrated mode exception: each subskill's own Exit Gate acceptance question IS the loop gate (Accept = continue to the next subskill).

## Entry Gate

Identical to the dispatcher — complete ALL of its entry-gate steps first:

1. Read `../orchestrator-framework/references/orchestrator-patterns.md` Section 7 (Dispatcher & Handoff Pattern) and Section 1 (Delegation Rules).
2. Detect prior work context: research folder path, `--research=<path>` flag, or quick-\* task path (same detection and state setup as the development dispatcher — see `../development/SKILL.md` Entry Gate).
3. Initialize (new task) or resume (task path): create task directory + `orchestrator-state.yml` with `verify_template` validation, discover `.owflow/docs/INDEX.md` project docs, write command flags to `options.*`. On resume, find the first phase NOT in `completed_phases` (validate artifacts; `--from=PHASE` overrides).
4. Create ONE task item via `TaskCreate` per subskill in the upcoming loop (subject: `"Phases N–M: <subskill>"`); update statuses as the loop progresses.

**Output**:

```
🚀 Orchestrated Development

Task: [description]
Directory: [task-path]
Loop: dev-analyze → [dev-tdd-red] → dev-spec → dev-plan → dev-implement → dev-verify → dev-finalize
```

---

## The Loop

For each subskill in sequence (skipping conditionals below), execute:

1. **Announce**: 1-line phase banner.
2. **Invoke**: Skill tool with `name: "<subskill>"` and `prompt: "<task-path> [flags relevant to that subskill]"`. The subskill owns its Entry Gate, delegation, and state updates.
3. **Verify handback**: after the skill returns, re-read `orchestrator-state.yml` — confirm the expected `phase-N` entries were appended. If a subskill stopped early (entry check failed), STOP the loop and relay its routing message to the user.
4. **Gate (subskill's Exit Gate is the loop gate)**: each subskill presents its results box and fires its own results-acceptance `question` before its handoff hint (Orchestrated-mode exception, `orchestrator-patterns.md` Section 9). Rule 5 of that section — "subskills only SUGGEST the next command" — is superseded for Accept: when the user answers **Accept** to the subskill's Exit Gate question pointing at the next subskill in this loop, treat that as "continue to the next subskill" and invoke it. Any other answer (Adjust / Discuss / Stop / other options picked) ends the loop the same way a rejected gate would.
   - **Exception**: no separate gate between `dev-analyze` and `dev-tdd-red` when the red gate activates — these two run back-to-back (mirrors the AUTO-CONTINUE of the classic orchestrator). A gate still applies between analysis and spec.

### Sequence and Conditionals

| Order | Subskill      | Run when (from state)                                    |
| ----- | ------------- | -------------------------------------------------------- |
| 1     | dev-analyze   | Always                                                   |
| 2     | dev-tdd-red   | `task_characteristics.has_reproducible_defect: true`     |
| 3     | dev-spec      | Analysis complete                                        |
| 4     | dev-plan      | `implementation/spec.md` exists                          |
| 5     | dev-implement | Spec + plan exist                                        |
| 6     | dev-verify    | `phase-7` completed                                      |
| 7     | dev-finalize  | `phase-10` completed; honors `e2e_enabled`/`user_docs_enabled` internally |

**Interruptible**: at any gate the user may answer "stop" — print the standard handoff block (next command + `/owflow:development <task-path>` resume hint) and end the session. The task resumes later in either mode.

---

## Exit Gate

When dev-finalize completes (`task.status: completed`):

1. Mark the final task item completed via `TaskUpdate`.
2. Present the workflow results box:

```
═══════════════════════════════════════════════════════
  DEVELOPMENT WORKFLOW COMPLETE: <task name>
═══════════════════════════════════════════════════════
  Phases:         [executed phase ranges]
  Verification:   [final verification outcome]
  Artifacts:      [task directory artifact summary]
  Commit message: [template]
═══════════════════════════════════════════════════════
```

3. Use `question` — "Are these results correct?" with options: **Accept** (print follow-up suggestions: `/owflow:reviews-pragmatic <task-path>`, `/owflow:standards-update "<lesson>"`, commit/PR, then end) / **Adjust** (re-open the relevant `/owflow:dev-*` skill) / **Discuss** (walk through the summary) / **Stop here** (print the resume command and end).

Then end. No further owflow phase commands are required.

---

## Loop Rules

- **Delegate, never inline**: the wrapper only sequences — all phase work happens inside subskills. If you catch yourself implementing/analyzing outside a subskill, STOP and invoke the subskill instead.
- **State is the truth**: gates and routing read `orchestrator-state.yml`, not memory. Re-read after every subskill returns.
- **Same state schema as handoff mode**: `completed_phases` values (`phase-1` … `phase-13`) are identical; resume works across modes.

## Command Integration

Invoked via:

- `/owflow:goal-development [description] [--e2e] [--user-docs] [--research=PATH]` (new)
- `/owflow:goal-development [task-path] [--from=PHASE]` (resume)

Alternative: `/owflow:development` — same task in handoff mode (one subskill per invocation, fresh context each phase).
