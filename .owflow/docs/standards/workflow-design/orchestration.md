## Orchestration

### Never Auto-Chain: Suggest and Stop
Subskills never auto-invoke the next skill; the orchestrated wrapper invokes. Subskills print the suggested next command and stop. Dispatchers derive the next step from state and stop. In assisted mode, the user's explicit invocation of the next command IS the phase gate — do not add an extra confirmation question.

### Subskill Entry Resolution and Blocked Prerequisites
Every subskill is standalone, resolves its task from a full path or directory identifier, and NEVER auto-picks a task; missing or ambiguous input prints a structured ask and waits. Unmet prerequisites print a blocked block with numbered ordered prerequisite steps (exact prefixed commands), the resumable task identifier, and the fresh-start hint — then STOP. Verify prerequisite content (state values, marker artifacts), not just file existence.

### Orchestrator Creation Checklist Compliance
Before an orchestrator is considered complete, verify all checklist items: framework load, Entry Gate, Exit Gate, explicit state creation and verification, phase structure (Purpose/Execute/Output/State/Transition), delegation enforcement blocks, POST-CONTINUATION blocks, accumulated context passing, phase_summaries extraction, decision gates via question, standards references, TaskCreate initialization with blockedBy dependencies, auto-recovery table, and domain context schema.

### Approved Spec Before Implementation Planning
A user-approved `spec.md` must exist in the task directory before the implementation-planner subagent is invoked; planning requires spec.md, and implementation requires spec.md plus implementation-plan.md.

### Continuous Standards Discovery
Re-check `.owflow/docs/standards/` at the spec phase, at each task-group start, and before the final verification report. Standards are consulted before specification, during planning, and while coding — not just once at the start.
