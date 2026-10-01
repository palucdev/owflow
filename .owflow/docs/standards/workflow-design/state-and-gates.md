## State Management and Gates

### Entry/Exit Gate Contract and State Update Discipline
Every user-invocable skill opens with an Entry Gate (argument resolution, prerequisite table, blocked output) and closes with an Exit Gate: results box, then a mandatory results-acceptance question (Accept / Adjust / Discuss / Stop), and the next-step hint only after Accept. State is written per-step during execution and MUST NOT be marked completed until AFTER the user responds to the exit gate — the gate is the first action after phase work.

### State File Canonical with Descriptive Slugs; Task System Mirrors
`orchestrator-state.yml` is the single source of truth for resume logic; the task system (TaskCreate/TaskUpdate) only mirrors it for UX. `completed_phases`/`failed_phases`/`auto_fix_attempts` use descriptive step slugs (e.g., `codebase-analysed`, `spec-written`, `synthesis-complete`), not `phase-N` numbers, and slug values MUST stay stable so assisted and autonomous modes intermix freely on the same task.

### verify_template Validation After State Creation
Use the `verify_template` tool immediately after creating or updating `orchestrator-state.yml` to validate its structure against the workflow's template. Bootstrapped state must also be validated.

### Orchestrator State Templates Share a Schema
State templates live at `src/templates/orchestrator-state-<workflow>.yml` (base + development/migration/performance/research) and share the same `orchestrator` and `task` sections; workflow templates extend the base with context-specific sections only.

### Post-Compaction State Re-Read
After context compaction, re-read `orchestrator-state.yml` in the active task directory to verify `completed_phases` and determine the next phase, and continue using the question tool at phase gates. The compaction lifecycle hook injects this reminder.
