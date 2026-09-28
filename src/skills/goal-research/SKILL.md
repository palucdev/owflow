---
name: owflow:goal-research
description: Full orchestrated research wrapper — runs ALL research steps in one session by invoking every research-* subskill in sequence with question gates between them (equivalent to the classic unified orchestrator for research). Use /owflow:research for the same lifecycle in assisted mode — tasks can mix both modes freely.
argument-hint: "[task description | task-path] [--from=<slug>] [--type=<type>]"
user-invocable: true
---

# Orchestrated Research Wrapper

Autonomous mode for research tasks. Initializes (or resumes) the task, then invokes every required `research-*` subskill back-to-back via the Skill tool, pausing at gates between subskills. Shares `orchestrator-state.yml` with assisted mode (`/owflow:research`) — tasks can mix both modes freely.

Gates follow the shared contract in [Gate Contract](../orchestrator-framework/references/gate-contract.md) — orchestrated mode exception: each subskill's own Exit Gate acceptance question IS the loop gate (Accept = continue to the next subskill).

## Input / Output Artifacts

| Artifact                            | Normal mode (this wrapper)                                                  | Quick mode (`research-quick`)                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Consumed: argument (question / path)| research question (new task) or task path/identifier (resume)                 | n/a — this wrapper never starts a quick run; a completed quick pass just skips rows 2-3            |
| Consumed/produced: all task artifacts| owned entirely by the invoked subskills (none here — delegate, never inline) | same — the subskills run at full fidelity after a quick pass                                       |
| State write                         | `orchestrator.task_ids` (task items) + `orchestrator.updated` only            | none additional — state was already written by the quick pass                                      |

## Entry Gate

Identical to the research dispatcher — complete ALL of its entry-gate steps first (see `../research/SKILL.md` Entry Gate):

1. Read the framework reference files NOW, exactly as the research dispatcher's Step 1: the [Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md), the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md), and the [Orchestrator Patterns](../orchestrator-framework/references/orchestrator-patterns.md).
2. Resolve the argument the same way the research dispatcher does: task path or identifier (a directory, or a directory name under `.owflow/tasks/research/`) → **resume mode** (read `orchestrator-state.yml`, validate expected artifacts for `completed_phases`; find the first step slug NOT in `completed_phases`, with `--from=<slug>` overriding); a research question (free text) → new task; nothing provided → ask via `question` — "What is your research question?" — then WAIT. Missing state file → print `No research task found at <path>. Run /owflow:research <question> to start from scratch.` and STOP.
3. Initialize (new task) exactly as the dispatcher: create `.owflow/tasks/research/YYYY-MM-DD-task-name/` + `orchestrator-state.yml` from the research template — `task.title` / `task.description` from the question, `task.status: in_progress`, `orchestrator.task_path`, `orchestrator.entry_point: "research"`. **CRITICAL**: use the `verify_template` tool immediately after creation to check YAML validity against `orchestrator-state-research.yml`. No project-docs discovery at this layer — the `research-plan` brief step owns it.
4. Command flags: `--type=TYPE` → `research_context.research_type`. Subskills read it from there. This wrapper never forwards quick runs. The optional brainstorm/design chain has no flags — the chain decision is asked at the gate after synthesis (row 4 below) or made by manually invoking the optional subskills.
5. Create ONE task item via `TaskCreate` per subskill in the upcoming loop (subject: `"<step name>: <subskill>"`, e.g. `"Brief + plan: research-plan"`), then set the execution order with `TaskUpdate addBlockedBy` (plan → gather → synthesize → optional chain (gate question) → finalize). On resume, refresh the already-evidenced items instead of re-creating them. Update statuses as the loop progresses.

**Output**:

```
🚀 Orchestrated Research

Task: [research question]
Directory: [task-path]
Loop: research-plan → research-gather → research-synthesize → [research-brainstorm] → [research-converge] → [research-design] → research-finalize (chain asked at the gate)
```

---

## The Loop

For each subskill in sequence, execute — skipping any row whose condition is not met (a row whose slug is already in `completed_phases` counts as done):

1. **Announce**: 1-line step banner.
2. **Invoke**: Skill tool with `name: "<subskill>"` and `prompt: "<task-path> [flags relevant to that subskill]"`. The subskill owns its Entry Gate, delegation, and state updates.
3. **Verify handback**: after the skill returns, re-read `orchestrator-state.yml` — confirm the expected step slugs were appended to `completed_phases` (per the Sequence and Conditionals table). A user-chosen skip of `research-brainstorm` or `research-design` appends no slug — the gate answer itself settles the decision, and the loop continues to the next selected row (or to finalize). Do not treat a skipped optional subskill as an early stop. If a subskill stopped early (entry check failed), STOP the loop and relay its routing message to the user.
4. **Gate (subskill's Exit Gate is the loop gate)**: each subskill presents its results box and fires its own results-acceptance `question` before its handoff hint (Orchestrated-mode exception, [Gate Contract](../orchestrator-framework/references/gate-contract.md)). [Rule 5 of the Dispatcher & Handoff Pattern](../orchestrator-framework/references/dispatcher-handoff.md) — "subskills only SUGGEST the next command" — is superseded for Accept: when the user answers **Accept** to the subskill's Exit Gate question pointing at the next subskill in this loop, treat that as "continue to the next subskill" and invoke it. Any other answer (Adjust / Discuss / Stop / other options picked) ends the loop the same way a rejected gate would.
   - **Exception**: the per-area convergence `question`s `research-converge` fires (one area, one question) are part of that subskill's own decision flow — they are NOT the loop gate and are NEVER auto-accepted or answered by this wrapper. There is exactly ONE gate definition per subskill hop; the wrapper adds NO second consecutive `question`.
   - **Condensed lane**: this wrapper never starts a quick run. A task already started with `/owflow:research-quick` enters the loop with `brief-written` … `synthesis-complete` already recorded, so those rows are skipped like any other completed slug. An interrupted quick pass (those slugs missing) is not finished condensed here — the user runs `/owflow:research-quick <task-path>` for that.

### Sequence and Conditionals

| Order | Subskill           | Run when (from state)                                                                                             |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1     | research-plan      | Always (new task or partial foundation)                                                                                 |
| 2     | research-gather    | `plan-created` completed (parses `## Gathering Strategy`, or falls back to 4 default categories; existing findings count as done) |
| 3     | research-synthesize| `findings-gathered` completed                                                                                       |
| 4     | chain decision     | `synthesis-complete` completed — the wrapper asks via `question`: brainstorm → converge → design, design-only, or straight to finalize |
| 5     | research-brainstorm| User chose brainstorming at the gate (invoking/sequencing the skill IS the decision)                                 |
| 6     | research-converge  | `alternatives-generated` completed (brainstorm ran)                                                                 |
| 7     | research-design    | User chose design — after `approaches-chosen`, or the design-only branch (seeded from the research report)           |
| 8     | research-finalize  | Foundation complete + optional chain settled (every step the user chose to run is recorded)                          |

A completed quick pass already recorded `brief-written` … `synthesis-complete`, so rows 2-3 are skipped as already done and the loop continues at row 4 (the chain decision). This wrapper never starts a quick run.

The optional chain is the user's choice — asked at the gate (row 4) or made by manually invoking the optional subskills. There is no enablement flag in state:

- Brainstorm chosen → `research-brainstorm` → `research-converge` → design (if chosen) → finalize.
- Design-only chosen → skip the brainstorm + converge rows → `research-design` → finalize.
- Neither chosen → all conditional rows are skipped → `research-finalize`.

`research-completed` already in `completed_phases` → the task is TERMINAL: skip the Loop and present the wrapper Exit Gate.

**Interruptible**: at any gate the user may answer "stop" — print the standard handoff block (next command + `/owflow:research <task-path>` resume hint) and end the session. The task resumes later in either mode.

---

## Exit Gate

When research-finalize completes (`task.status: completed`):

1. Mark the final task item completed via `TaskUpdate`.
2. Present the workflow results box:

```markdown
## ✅ RESEARCH WORKFLOW COMPLETE — <research question>

**Steps** — [executed step slugs, e.g. brief-written → plan-created → findings-gathered → synthesis-complete → alternatives-generated → approaches-chosen → design-generated → research-completed]
**Confidence** — [research_context.confidence_level]
**Decisions** — [count of ADRs in the decision log, if design ran]
**Artifacts** — [artifact inventory: outputs/research-report.md always; outputs/solution-exploration.md / outputs/high-level-design.md / outputs/decision-log.md conditionally]
```

3. Use `question` — "Are these results correct?" with options: **Accept** (print follow-up suggestions: clear context, then `/owflow:development <task-path>` to build on this research, `/owflow:standards-update "<lesson>"` if a standard surfaced, then end) / **Adjust** (re-open the relevant `/owflow:research-*` skill with the corrections) / **Discuss** (walk through the research summary) / **Stop here** (print the resume command `/owflow:research <task-path>` and end).

Then end. No further owflow phase commands are required.

---

## Loop Rules

- **Delegate, never inline**: the wrapper only sequences — all step work happens inside subskills. If you catch yourself researching/authoring outside a subskill, STOP and invoke the subskill instead.
- **State is the truth**: gates and routing read `orchestrator-state.yml`, not memory. Re-read after every subskill returns.
- **Same state schema as assisted mode**: `completed_phases` step slugs (`brief-written` … `research-completed`) are identical; resume works across modes.
- **Wrapper writes almost nothing**: step slugs, summaries, and outputs belong to the subskills — this wrapper writes ONLY `orchestrator.task_ids` (task items) and `orchestrator.updated` (timestamps).

## Command Integration

Invoked via:

- `/owflow:goal-research [question] [--type=TYPE]` (new)
- `/owflow:goal-research [task-path] [--from=<slug>]` (resume)

Alternative: `/owflow:research` — same task in assisted mode (one subskill per invocation, fresh context each step).
