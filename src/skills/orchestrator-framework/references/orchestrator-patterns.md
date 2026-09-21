# Orchestrator Patterns

Shared execution rules, schemas, and patterns for all workflow orchestrators.

---

## 1. Delegation Rules

**Always use Skill/Task tools to delegate. Never execute delegated work inline.**

When a phase requires delegation:

1. Use the **Skill tool** for **skills** — loads SKILL.md instructions into the main agent's context; the main agent executes the skill's instructions and continues with the orchestrator workflow afterward
2. Use the **Task tool** for **subagents/agents** — spawns an isolated subprocess that returns results when complete
3. Wait for completion before continuing

**Skills and agents are NOT interchangeable.** Skills always use Skill tool; agents always use Task tool. Never invoke a skill via Task tool (`subagent_type`) — it will fail with "Agent type not found."

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementation-plan-executor`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners). Subagents cannot spawn other subagents — so these skills must run in the main agent context via Skill tool.

**Companion agent pattern** (e.g., `docs-operator`): Only works for skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. This pattern fails for any skill that needs to spawn subagents.

### Anti-Patterns

| Anti-Pattern                            | Why It's Wrong                              | Correct Approach                                      |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| "I'll analyze the codebase..."          | Bypasses codebase-analyzer skill            | Use `Skill` tool with `codebase-analyzer`             |
| "Let me create the specification..."    | Bypasses specification-creator              | Use `Task` tool with `specification-creator` subagent |
| "Looking at the gaps between..."        | Bypasses gap-analyzer subagent              | Use `Task` tool with `gap-analyzer`                   |
| "I'll implement this by..."             | Bypasses implementation-plan-executor skill | Use `Skill` tool with `implementation-plan-executor`  |
| Reading a SKILL.md then doing the work  | Skill files are instructions FOR skills     | Use Skill tool to invoke                              |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents    | Invoke skill, let IT spawn agents                     |

### When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** — question is direct
2. **State updates** — Reading/writing orchestrator-state.yml
3. **Phase announcements** — Outputting status messages
4. **Simple decisions** — Enabling/disabling optional phases
5. **Finalization** — Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):

- Specification creation → always delegate to `specification-creator` subagent
- Implementation planning → always delegate to `implementation-planner` subagent
- Gap analysis → always delegate to `gap-analyzer` subagent
- Codebase analysis → always delegate to `codebase-analyzer` skill
- Code review → always delegate to `code-reviewer` subagent
- Test execution → always delegate to `test-suite-runner` subagent
- Implementation completeness → always delegate to `implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation.

---

## 2. Phase Gate Behavior

**`→ Pause` means STOP and USE question.** This is NOT optional. You MUST invoke the `question` tool and WAIT for user response. Proceeding without it is a protocol violation.

All orchestrators pause at `→ Pause` transitions for user review and prompt for optional phases.

**State ordering rule**: Phase state MUST NOT be updated to 'completed' (via orchestrator-state.yml or TaskUpdate) until AFTER the user responds to the exit gate. Correct sequence: finish phase work → call question → receive user response → update state to completed.

### Phase Entry Checks

Every phase that follows a `→ Pause` gate includes an entry check at its TOP:

```
> **Phase gate**: Confirm Phase N completion before executing.
```

This catches missed gates: if the previous phase's `→ Pause` was skipped (e.g., the model output a summary and moved on), the entry check forces the gate to fire before the next phase executes. If the gate already fired, continue normally.

### AUTO-CONTINUE Rules

When a phase ends with `→ **AUTO-CONTINUE**`:

- You MAY output a brief phase summary (1-2 lines)
- Do NOT end your turn
- Do NOT use question
- Do NOT wait for user input
- After any summary, proceed immediately to the next phase

**Common mistake**: Outputting a summary and then stopping/ending the turn. The summary is fine — stopping is not.

### Anti-Patterns

| Anti-Pattern                                                                      | Why It's Wrong                                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Proceeding without question at phase gates                                        | User loses control, can't review or stop                                                                                                                                 |
| Saying "I'll pause here" without tool call                                        | Words are not pauses. Tool invocation required.                                                                                                                          |
| Auto-accepting subagent decisions without asking                                  | User must consent to scope/approach decisions                                                                                                                            |
| Outputting a summary after phase work, then ending turn before reaching `→ Pause` | Gate is skipped; user loses control at the most critical review point. The gate must be the FIRST action after phase work completes — no summaries, no output before it. |
| Marking phase as completed (state/TaskUpdate) before the exit gate executes       | State corruption — downstream phases see false "completed" status. Gate → user response → state update. Never reverse this order.                                        |

---

## 3. Context Passing & Decisions

### Context Passing

All subagent prompts must include context from prior phases:

```
prompt: |
  [Task instructions]
  Task path: [path]

  ## CONTEXT FROM PRIOR PHASES
  [Key state fields from orchestrator-state.yml]
  [Summaries of completed phases from phase_summaries]

  ## RESEARCH CONTEXT (if research_reference exists)
  Research question: [research_reference.research_question]
  Summary: [phase_summaries.research.summary]

  ## ARTIFACTS TO READ
  [List relevant files for full details]
```

**Why**: Subagents run in isolated context. Without summaries, they must re-parse entire files and miss prior decisions.

### Context Extraction

After each phase, extract key findings into `[domain]_context.phase_summaries`:

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Update state: `[domain]_context.phase_summaries.[phase_name]`

This enables context passing to downstream phases and supports resume.

**Critical**: Some subagent outputs contain structured fields that control downstream phase logic (e.g., `task_characteristics` from gap-analyzer gates Phase 4 and Phase 10 defaults). These MUST be extracted and written to state immediately — not just summarized. Re-read state after writing to verify the values were stored correctly.

### Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user via question. Decisions are never silently skipped.

**Anti-Patterns** (NEVER do this):

| Anti-Pattern                                    | Why It's Wrong                                       |
| ----------------------------------------------- | ---------------------------------------------------- |
| "I'll accept the recommended defaults"          | User loses control over critical scope decisions     |
| Logging decisions without asking                | Documentation is not consent                         |
| "The recommendations are clear, no need to ask" | Clarity is not consent. User may disagree.           |
| Skipping decisions because task seems simple    | Simple tasks can have non-obvious scope implications |

**Decision Gate Pattern**:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present**: Use `question` for each critical decision; batch important decisions into multi-select
3. **SELF-CHECK**: "Did I present ALL decisions from `decisions_needed`? If not, STOP."

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.owflow/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`.

### Common Fields

Refer to the template [src/templates/orchestrator-state-base.yml](../../../templates/orchestrator-state-base.yml).

### Extension Pattern

Orchestrators add domain-specific fields using `[domain]_context`:

| Domain      | Context Field         | Example Fields                                     |
| ----------- | --------------------- | -------------------------------------------------- |
| Development | `task_context`        | risk_level, ui_heavy, architecture_decision        |
| Performance | `performance_context` | baseline_p95, target_p95, optimizations_completed  |
| Migration   | `migration_context`   | migration_type, steps_completed                    |
| Research    | `research_context`    | research_type, research_question, confidence_level |

See each orchestrator's SKILL.md "Domain Context" section for full schema.

### Shared: research_reference

When development starts from completed research (`--research` flag):

Refer to `research_reference` in the template [src/templates/orchestrator-state-development.yml](../../../templates/orchestrator-state-development.yml).

Research context flows to ALL phases via context passing. Artifacts are also copied to `analysis/research-context/`.

### Shared: verification_context

All orchestrators with verification phases use:

Refer to `verification_context` in the template [src/templates/orchestrator-state-base.yml](../../../templates/orchestrator-state-base.yml) or domain templates.

---

## 5. Initialization & Resume

### Initialization Steps

1. **Parse arguments**: Extract description, type, entry point (`--from`), optional flags
2. **Determine starting phase**: New task starts Phase 1; resume reads state for first incomplete phase
3. **Create task directory**: Standard structure with analysis/, implementation/, verification/, documentation/ _(skip on resume)_
4. **Create state file**: `orchestrator-state.yml` _(skip on resume)_
   - **CRITICAL**: Use the `verify_template` tool immediately after creation to check YAML validity against the corresponding template.
5. **Create task items**: `TaskCreate` for all phases, then `TaskUpdate addBlockedBy` for dependencies. On resume, also restore completed phase statuses.
6. **Output summary**: Show task info, phases, starting message

### Task Name Generation

1. Extract 3-5 key words from description
2. Convert to lowercase kebab-case
3. Prepend current date: `YYYY-MM-DD`

Examples: "Fix login timeout bug" → `2025-12-17-fix-login-timeout`

### Task Restoration on Resume

Task system IDs are ephemeral to a session. On resume:

1. Create all phase tasks (same `TaskCreate` loop, all start pending)
2. Set dependencies (same `TaskUpdate addBlockedBy`)
3. Mark completed phases (`TaskUpdate` to `completed` with `metadata: {restored: true}`)
4. Update state with new task IDs

### Resume Logic

1. **Read state file** — Load `orchestrator-state.yml`
2. **Validate artifacts** — Check expected files for `completed_phases`. If missing, remove from list.
3. **Find resume point** — First phase not in `completed_phases`
4. **Check prerequisites** — Verify required artifacts exist
5. **Restore task items** — Re-create phase tasks and mark completed ones

| Starting From  | Required Prerequisites           |
| -------------- | -------------------------------- |
| Gap Analysis   | `analysis/codebase-analysis.md`  |
| Specification  | `analysis/gap-analysis.md`       |
| Planning       | `implementation/spec.md`         |
| Implementation | spec.md + implementation-plan.md |
| Verification   | Implementation complete          |

If prerequisites missing, use question: "Start from Phase 1", "Specify different phase", or "Exit".

---

## 6. Issue Resolution

**Don't just report issues — resolve them.** Use after verification phases that return structured issues.

### Fix-Then-Reverify Loop

1. Read verification results (structured issues)
2. For each issue: trivial/auto-fixable → fix silently, log action; non-trivial → question
3. If fixes applied → set `skip_test_suite: false` (code changed) → re-run verification
4. Loop until: passes OR user proceeds with known issues OR max iterations (3)

### Fixability Assessment

| Likely Fixable      | Likely Not Fixable         |
| ------------------- | -------------------------- |
| Lint errors         | Architecture decisions     |
| Formatting issues   | Design trade-offs          |
| Missing imports     | Test logic errors          |
| Obvious typos       | Unclear requirements       |
| Simple config fixes | Performance tuning choices |

### Exit Conditions

| Condition                                | Action                                             |
| ---------------------------------------- | -------------------------------------------------- |
| Verification passes                      | Proceed to next phase                              |
| User chooses "Proceed with known issues" | Proceed with warning logged                        |
| Max iterations (3) reached               | Ask user how to proceed                            |
| Critical issues remain unresolved        | **MUST NOT proceed** — require user approval first |

---

## 7. Dispatcher & Handoff Pattern (Subskill Loop)

Orchestrators MAY delegate phase bodies to user-invocable **subskills** instead of executing them inline. Two loop modes share one state file and one set of subskills:

| Mode              | Entry point              | Behavior                                                                                                |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Orchestrated mode | wrapper skill/command    | Invokes subskills back-to-back via Skill tool in sequence; pauses at `question` gates between subskills |
| Handoff mode      | dispatcher skill/command | Derives next phase from state, prints the suggested command, and **STOPS**; user invokes each subskill  |

### Rules

1. **State file is canonical.** `orchestrator-state.yml` remains the single source of truth. Subskills read it on entry and write step results on exit. `completed_phases` values MUST stay stable so both modes intermix freely on the same task.
   - **Value convention**: `completed_phases` / `failed_phases` / `auto_fix_attempts` keys are **descriptive step slugs**, not `phase-N` numbers. The development workflow defines the canonical slugs (`codebase-analysed`, `gap-analysed`, `tdd-red-proven`, `spec-written`, `spec-audited`, `plan-created`, `implementation-done`, `tdd-green-proven`, `options-chosen`, `verification-done`, `e2e-run`, `docs-generated`, `task-completed` — see `skills/development/SKILL.md` routing table and `templates/orchestrator-state-development.yml`). New orchestrators SHOULD use descriptive step slugs too; older orchestrators (performance, migration, research) still use `phase-N` and MUST be kept internally consistent.
2. **Subskills are self-contained.** Each has: an entry check (validate state + prerequisite artifacts), an execute section (delegation via Skill/Task tools per Section 1), and an exit (state update + closing ritual). **State updates are per-step**: a subskill writes `orchestrator-state.yml` immediately after each of its steps completes — appending only the step slug actually performed, bumping `orchestrator.updated`, recording failures in `failed_phases`/`auto_fix_attempts`, and validating with `verify_template` — never as a single end-of-skill write.
3. **Closing ritual (handoff) → Exit Gate.** Every subskill ends with the **Exit Gate** contract defined in Section 9 (results box → results-acceptance question → next-step hint on accept → STOP).
4. **Entry checks replace phase gates in handoff mode.** A subskill invoked directly must validate the same prerequisites a phase gate would (e.g., spec exists before audit) and route to the prerequisite's command if missing — via its **Entry Gate** (Section 9).
5. **Never chain automatically.** The orchestrated wrapper invokes; subskills only SUGGEST the next command and stop. Auto-chaining from a subskill skips user review.
6. **Handoff mode is the gate.** In handoff mode, the user explicitly invoking the next command IS the phase gate — no additional `question` confirmation before a subskill starts.

---

## 8. Command Namespacing

- Slash commands registered from `src/commands/*.md` use `name: owflow:<command>` in frontmatter; users invoke `/owflow:<command>`.
- **Skill `name:` fields are prefixed too.** Skill-tool invocations (`skill: "owflow:development"`, `skills:` frontmatter preloads, work.md routing) always reference `owflow:`-prefixed skill names.
- Handoff messages, docs, and cross-references always display the prefixed slash command — never the bare skill name — in user-facing text.

---

## 9. Entry Gate & Exit Gate (Skill Contract)

Every **user-invocable** skill (orchestrators, subskills, dispatchers, utility commands) opens with an **Entry Gate** and closes with an **Exit Gate**. Internal skills (subagent-invoked, `user-invocable: false`) use lightweight input/structured-output contracts instead and never call `question`.

### Entry Gate

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

### Exit Gate

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

4. **Gate ordering** — per Section 2's state ordering rule: finish phase work → present results box → acceptance question → user responds → THEN the state is already consistent (per-step writes happened during Execute); the Exit Gate never mutates phase state on its own except recording the user's acceptance decision where the state schema has a field for it.

### Exceptions

- **Dispatchers** (`development`): the Exit Gate's acceptance question is adapted — the results box is the handoff block, and the question asks how to proceed (hand off to the suggested subskill / switch to loop mode / adjust / stop).
- **Utility skills with explicit no-follow-up contracts** (`agents-md-generator`, `rule-reviewer`): the acceptance question is confirm-or-revise only; follow-up suggestions stay prohibited unless the user asks.
- **Orchestrated mode** (`goal-development`): the subskill's own Exit Gate acceptance question IS the loop gate — Accept means "continue to the next subskill". The wrapper MUST NOT add a second consecutive `question`.
