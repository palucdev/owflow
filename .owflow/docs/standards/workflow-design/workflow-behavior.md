## Workflow Behavior

### Task Directory Naming Convention
Task directories use `YYYY-MM-DD-task-name`: extract 3-5 key words from the description, convert to lowercase kebab-case, and prepend the current date so tasks sort chronologically.

### Skill Invocation as First Action
When a skill command is invoked, invoke it via the skill tool as the FIRST action — do not analyze first, do not decide it is straightforward, and do not substitute another approach. Synthesized command wrappers encode this as a CRITICAL INSTRUCTION.

### Quick Lanes Produce Standard Continuable Tasks
Quick lanes exist as `--quick` flags on `dev-spec`, `dev-plan`, and `dev-implement`, and as dedicated skills (`dev-bugfix` for bug-shaped work, `research-quick` for research); migration and performance have none. Every lane bootstraps a standard task (full `orchestrator-state.yml`) with the lane recorded as `orchestrator.entry_point`, stops at its own exit gate, and stays continuable by any subskill at full fidelity. `dev-bugfix` also resets downstream verification slugs when run on an existing task.

### Mandatory Rollback Planning for Migrations
Migration workflows must include mandatory rollback planning and halt on data integrity issues — no automatic recovery. Risk assessment and incremental execution are required; data migrations add integrity checks and dual-run support.

### Fix-Then-Reverify; Critical Issues Block Progression
Do not just report issues — resolve them. Fix and log trivial/auto-fixable issues; send non-trivial ones to the user via question. If fixes are applied, re-run verification. Loop until pass, user proceeds with known issues, or max 3 iterations. Critical unresolved issues MUST NOT proceed without user approval.

### Research Optional Chain Has No Enablement Flag
The research brainstorm/design chain is the user's choice with no flag and no separate decision step: invoking `research-brainstorm` or `research-design` IS the decision to run it; skipping to `research-finalize` settles the chain as skipped. In goal-research mode, ask at the gate after synthesis.

### Review and Audit Commands Are Read-Only
Standalone review/audit commands modify no source: each delegates straight to a subagent and writes its report beside what it reviewed. They run anytime, independent of a workflow, and do not advance phases.
