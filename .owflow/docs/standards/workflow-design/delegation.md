## Delegation

### Always Delegate via Skill/Task Tools
Always use the Skill tool for skills and the Task tool for subagents; never execute delegated work inline. Skills and agents are not interchangeable — never invoke a skill via Task tool (`subagent_type`) and never run an agent's work in the main context. "The task is simple" is NOT a valid reason to skip delegation.

### Companion-Agent Pattern Only for Non-Spawning Skills
The companion-agent pattern (e.g., docs-operator) only works for skills that do NOT spawn subagents. Skills that spawn their own subagents must run in the main agent context via the Skill tool; do not copy the companion pattern for them.

### Accumulated Context Passing to Subagents
All subagent prompts include an ACCUMULATED CONTEXT section with key state fields and summaries of completed phases from `phase_summaries`. After each phase, extract key findings into `[domain]_context.phase_summaries`, and write state-controlling structured outputs (e.g., `task_characteristics`, `has_reproducible_defect`) to state immediately, then re-read to verify.

### Decisions Are Never Silently Skipped
When a subagent returns `decisions_needed`, the orchestrator MUST present them to the user via the question tool — critical decisions individually, important decisions batched into multi-select. Accepting recommended defaults, logging decisions without asking, or skipping decisions because the task seems simple are prohibited: clarity is not consent.
