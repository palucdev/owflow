# Gate Contract — Entry Gate & Exit Gate (Skill Contract)

Shared contract for how every user-invocable skill opens and closes. Extracted from `orchestrator-patterns.md` (Section 9) so skills can link to it directly.

Every **user-invocable** skill (orchestrators, subskills, dispatchers, utility commands) opens with an **Entry Gate** and closes with an **Exit Gate**. Internal skills (subagent-invoked, `user-invocable: false`) use lightweight input/structured-output contracts instead and never call `question`.

## Entry Gate

The Entry Gate runs BEFORE any phase work. It validates that this skill is allowed to run and routes to what is missing instead of guessing.

1. **Argument resolution** — resolve the argument in priority order: full path → identifier (directory name under the workflow's task type) → fresh description. If missing, ambiguous, or unmatched:
   - Print a structured ask: the exact inputs accepted, with format examples, then WAIT.
   - NEVER guess, auto-pick a task, or proceed with a resolved-by-hope path.
2. **Prerequisite check** — verify each required upstream artifact, expressed as a table the skill keeps at the top of its body:

   | Required for this skill | Where verified                                                      | Produced by                  |
   | ----------------------- | ------------------------------------------------------------------- | ---------------------------- |
   | State file exists       | `<task-path>/orchestrator-state.yml`                                | `/owflow:development <desc>` |
   | Analysis done           | `gap-analysed` in `completed_phases` + `analysis/gap-analysis.md` exists | `/owflow:dev-analyze`        |
   | Spec approved           | `implementation/spec.md` exists                                     | `/owflow:dev-spec`           |

   Verify **presence and, where cheap, content** (state field values like `has_reproducible_defect`, marker artifacts like `implementation/tdd-red-gate.md`), not just file existence.

3. **Blocked output** — when a prerequisite is unmet, print the blocked block and STOP:
   1. Numbered "Steps that must be completed first (in order)", each with its exact prefixed command (`/owflow:dev-analyze <task-path>`).
   2. List of resumable task identifiers (directories under the workflow's task type), if any exist.
   3. Fresh-start hint: `Run /owflow:<entry-command> <description> to start a task from scratch.`
4. **Skip/resume semantics** — when the skill's steps are already in `completed_phases` (validate artifacts before trusting state): report the existing results briefly and route to the Exit Gate instead of re-executing.
5. **Conditional activation** — skills that only apply under a state condition (e.g., TDD red gate requires `has_reproducible_defect: true`) check it as part of the Entry Gate and route to the correct alternative command when inactive.

### Missing-state bootstrap (mid-pipeline entry)

When a dev-* subskill is invoked with a task path/identifier whose `orchestrator-state.yml` exists nowhere (no task, no state file) and the ONLY unmet prerequisite is the state file itself, the skill does not blindly send the user back to the full pipeline — the user chose to enter mid-pipeline. Instead:

1. **Ask** via `question`: "No development task exists at this path. Create a fresh standard development task and start at `<this skill's first step slug>`?"
2. **On confirm (bootstrap)**:
   - Create the task directory `.owflow/tasks/development/YYYY-MM-DD-task-name/` (name derived from the argument or the user's input) — mark `orchestrator.entry_point: "<skill> (mid-pipeline bootstrap)"` and `started_phase` with this skill's starting step slug.
   - Create `orchestrator-state.yml` from `orchestrator-state-development.yml`, honoring any of the skill's command flags into `options.*`; leave `completed_phases` empty (upstream steps stay unrecorded).
   - Run `verify_template` against `orchestrator-state-development.yml`.
   - Then continue into Execute. Because bootstrapping creates **state only — never upstream artifacts**, later artifact prerequisites (e.g., `implementation/spec.md` before planning) still block with the normal precondition loop, so an incorrectly early bootstrap cannot silently skip work.
3. **On decline** — print the blocked block with the fresh-start hint (`Run /owflow:development <description> to start a task from scratch.`) and STOP.

Skill starting points (used for the bootstrap question and `started_phase`): dev-analyze → `codebase-analysed`; dev-tdd-red → `tdd-red-proven`; dev-spec → `spec-written`; dev-plan → `plan-created`; dev-implement → `implementation-done`; dev-verify → `options-chosen`; dev-finalize → `e2e-run`.

### Deterministic entry checks (future)

Entry-gate checks above are currently executed by the agent reading state. For more deterministic routing, future work considers (a) a small script that checks whether `orchestrator-state.yml` exists, parses it, and answers slug/next-step queries, and (b) an OpenCode lifecycle hook that automates these entry-gate checks for dev-* skills before they run. Until then, follow the rules above exactly as written.

## Exit Gate

The Exit Gate runs after all phase work and state updates are final. It presents results, asks the user to confirm them, and only then hands off.

1. **Results box** — one-screen markdown summary (no ASCII borders, markdown headings/bold carry the emphasis):

   ```markdown
   ## ✅ <SKILL> COMPLETE — <task name>

   **<Field 1>** — [key outcome]
   **<Field 2>** — [key outcome]

   **Artifacts**

   - `relative/path/to/artifact.md`

   **Next ▸** `/owflow:<next-skill> <task-path>`
   ```

   Conventions:
   - Status glyphs follow the outcome: ✅ pass/success, ⚠ pass-with-concerns/partial, ❌ fail.
   - Set the **Next ▸** line to the suggested next command for this skill; omit it when the next-step hint depends on the Accept response (the handoff block is printed after Accept anyway).

2. **Results-acceptance question** (MANDATORY, fires before any handoff hint):

   Use `question` — "Are these results correct?" with options:
   - **Accept** — results are good; proceed to the next-step hint.
   - **Adjust** — user specifies what to change; re-work ONLY the affected parts, update artifacts/state, then re-present the results box and re-ask.
   - **Discuss** — walk through a specific result in more depth (evidence, reasoning, alternatives); after the discussion, re-ask.
   - **Stop here** — artifacts persist; print the resume command (`/owflow:<this-skill> <task-path>` or the next phase command) and end.

3. **Next-step hint** — only after Accept: print the suggested next command derived from state, plus an "Other options" block of alternative valid commands. Every suggested command is a **compact annotated entry**:
   - **Purpose** — one line stating what the proposed skill does.
   - **Requirement tag** — `required` (mandatory next phase) or `optional` (shortcut, standalone utility, or conditional step) with its activation condition, e.g. `optional — only when has_reproducible_defect: true`.
   - **Remaining plan** (for optional/alternative paths) — one compact line listing the phases still ahead in execution order, marking which are optional.
   - Standalone review/utility commands are annotated `optional — does not advance phases`.

   Example shape (~5 lines):

   ```
   → /owflow:dev-verify <task-path>
     What: runs the verification pipeline (completeness, code review, fixes) — required before commit. Remaining after: /owflow:dev-finalize (required).
   Other options:
   /owflow:reviews-code <task-path> — optional, does not advance phases (standalone re-run of code review)
   /owflow:goal-development <task-path> — optional shortcut: runs all remaining phases in one loop (… → verify → finalize)
   ```

   Then STOP. Never auto-invoke the next skill.

4. **Gate ordering** — per the Phase Gate Behavior state ordering rule in `orchestrator-patterns.md`: finish phase work → present results box → acceptance question → user responds → THEN the state is already consistent (per-step writes happened during Execute); the Exit Gate never mutates phase state on its own except recording the user's acceptance decision where the state schema has a field for it.

## Exceptions

- **Dispatchers** (`development`): the Exit Gate's acceptance question is adapted — the results box is the handoff block, and the question asks how to proceed (hand off to the suggested subskill / switch to autonomous mode / adjust / stop).
- **Utility skills with explicit no-follow-up contracts** (`agents-md-generator`, `rule-reviewer`): the acceptance question is confirm-or-revise only; follow-up suggestions stay prohibited unless the user asks. See [confirm-or-revise exception](confirm-or-revise-exception.md).
- **Orchestrated mode** (`goal-development`): the subskill's own Exit Gate acceptance question IS the loop gate — Accept means "continue to the next subskill". The wrapper MUST NOT add a second consecutive `question`.
