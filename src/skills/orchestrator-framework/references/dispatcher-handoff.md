# Dispatcher & Handoff Pattern (Subskill Loop)

How orchestrators delegate phase bodies to user-invocable **subskills**. Extracted from `orchestrator-patterns.md` (Section 7) so skills can link to it directly.

Orchestrators MAY delegate phase bodies to user-invocable **subskills** instead of executing them inline. Two modes share one state file and one set of subskills:

| Mode              | Entry point              | Behavior                                                                                                |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Orchestrated mode | wrapper skill/command    | Invokes subskills back-to-back via Skill tool in sequence; pauses at `question` gates between subskills |
| Assisted mode      | dispatcher skill/command | Derives next phase from state, prints the suggested command, and **STOPS**; user invokes each subskill  |

## Rules

1. **State file is canonical.** `orchestrator-state.yml` remains the single source of truth. Subskills read it on entry and write step results on exit. `completed_phases` values MUST stay stable so both modes intermix freely on the same task.
   - **Value convention**: `completed_phases` / `failed_phases` / `auto_fix_attempts` keys are **descriptive step slugs**, not `phase-N` numbers. The development workflow defines the canonical slugs (`codebase-analysed`, `gap-analysed`, `tdd-red-proven`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `tdd-green-proven`, `options-chosen`, `verification-done`, `e2e-run`, `docs-generated`, `task-completed` — see `skills/development/SKILL.md` routing table and `templates/orchestrator-state-development.yml`). New orchestrators SHOULD use descriptive step slugs too; older orchestrators (performance, migration, research) still use `phase-N` and MUST be kept internally consistent.
2. **Subskills are self-contained.** Each has: an entry check (validate state + prerequisite artifacts), an execute section (delegation via Skill/Task tools per the [Delegation Rules](delegation-rules.md)), and an exit (state update + closing ritual). **State updates are per-step**: a subskill writes `orchestrator-state.yml` immediately after each of its steps completes — appending only the step slug actually performed, bumping `orchestrator.updated`, recording failures in `failed_phases`/`auto_fix_attempts`, and validating with `verify_template` — never as a single end-of-skill write.
3. **Closing ritual (handoff) → Exit Gate.** Every subskill ends with the **Exit Gate** contract, see [Gate Contract](gate-contract.md) (results box → results-acceptance question → next-step hint on accept → STOP).
4. **Entry checks replace phase gates in assisted mode.** A subskill invoked directly must validate the same prerequisites a phase gate would (e.g., spec exists before audit) and route to the prerequisite's command if missing — via its **Entry Gate** ([Gate Contract](gate-contract.md)).
5. **Never chain automatically.** The orchestrated wrapper invokes; subskills only SUGGEST the next command and stop. Auto-chaining from a subskill skips user review.
6. **Assisted mode is the gate.** In assisted mode, the user explicitly invoking the next command IS the phase gate — no additional `question` confirmation before a subskill starts.
