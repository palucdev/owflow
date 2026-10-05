---
name: owflow:performance-spec
description: Performance — requirements gathering, specification creation via delegation, diagram refinement, and conditional specification audit. Continues with performance-plan.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Performance Spec — Requirements, Specification & Conditional Audit (spec-written, spec-audited)

Work step of the performance workflow. Presents the bottleneck analysis, gathers optimization priorities, constraints, and targets, creates the specification via delegation, refines it with diagrams, then offers an independent specification audit. State lives in `orchestrator-state.yml` — this skill reads it on entry and writes results on exit.

## Entry Gate

Resolve the argument BEFORE anything else (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). The argument may be:

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/performance/` (e.g., `2026-10-02-api-latency`); resolve to its path.
- **Description** — anything else (free text) is treated as a new performance task description: ask via `question` whether to start a fresh standard task at this step (mid-pipeline bootstrap) or route through `/owflow:performance <description>`; on decline, print the blocked block and STOP.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):

1. Steps that must be completed first (in order), each with its command:
   - Codebase & bottleneck analysis (`codebase-analysed`, `bottlenecks-identified`) → `/owflow:performance-analyze <task-path>`
2. List available performance-task identifiers (directories under `.owflow/tasks/performance/`) to resume from, if any.
3. Hint: `Run /owflow:performance <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill        | Where verified                                                                              | Produced by                          |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| State file exists              | `<task-path>/orchestrator-state.yml`                                                        | `/owflow:performance <desc>`         |
| Bottleneck analysis done       | `bottlenecks-identified` in `completed_phases` + `analysis/performance-analysis.md` exists  | `/owflow:performance-analyze <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → mid-pipeline bootstrap ([Missing-state Bootstrap](../orchestrator-framework/references/gate-contract.md), starting slug `spec-written`): `question` — create a fresh standard performance task starting at this step, or decline → print `No performance task found at <path>. Run /owflow:performance <description> to start a task from scratch.` and STOP.
2. **Skip/resume (artifacts before state)**:
   - If `spec-written` is complete but `implementation/spec.md` is missing → drop the slug and re-run the specification step.
   - If `spec-written` and `spec-audited` are complete: validate `verification/spec-audit.md` exists; missing → drop `spec-audited` and run the audit sub-step; otherwise report existing results and route to the Exit Gate.
   - If only `spec-written` is complete: `options.spec_audit_enabled: false` → report the spec summary and route to the Exit Gate (do not re-ask); otherwise (`null` or `true`) skip directly to the audit sub-step — never re-run Requirements Gathering or Specification Creation.
3. **Audit skip/resume rule (audit-decision guard)**: the audit question is asked while `options.spec_audit_enabled` is `null`, and only then; a resume with `true` and the audit artifact missing goes straight to the auditor without re-asking. On skip, write `options.spec_audit_enabled: false` and NO `spec-audited` entry; a later resume with `false` does not re-ask. The audit is the conditional activation of this skill's second slug.
4. **Prerequisite check (presence and content)**: `bottlenecks-identified` in `completed_phases` AND `analysis/performance-analysis.md` exists. If missing → print the blocked block, then STOP:
   - Steps that must be completed first: codebase & bottleneck analysis (`codebase-analysed`, `bottlenecks-identified`).
   - `Run /owflow:performance-analyze <task-path> first.`
   - If no task exists yet: `Run /owflow:performance <description> to start a task from scratch.`

## Execute

**Read first**: the [Delegation Rules](../orchestrator-framework/references/delegation-rules.md).

### Requirements Gathering (part of `spec-written`, inline)

1. Present the bottleneck summary from `analysis/performance-analysis.md` (P0-P3 counts and top findings).
2. `question` for optimization requirements:
   - Which bottleneck priorities to address? (All P0+P1 / P0 only / specific ones)
   - Any constraints? (backward compatibility, memory limits, no new dependencies)
   - Performance targets? (specific response-time or throughput goals, if known)
3. Save to `analysis/requirements.md`: performance issue description, bottleneck analysis summary, optimization priorities, constraints, targets.
4. **Standards discovery**: Read `.owflow/docs/INDEX.md` before creating the spec.

### Specification Creation (part of `spec-written`, subagent)

**ANTI-PATTERN — never write spec.md yourself. "The optimization is straightforward" is NOT a reason to skip delegation.**

- ❌ "Let me create the specification..." — STOP. Delegate to `specification-creator`.
- ❌ "I'll write the spec based on the analysis..." — STOP. Delegate to `specification-creator`.

**INVOKE NOW** (Task tool — never the Skill tool; this is an agent): Task tool - `specification-creator` subagent. Pass (Pattern 7 — accumulated context): task_path, task_type="performance", task_description, requirements_path (`analysis/requirements.md`), project_context_paths (INDEX.md + `performance_context.project_doc_paths` from state), `performance_context.task_characteristics`, `performance_context.bottleneck_priorities`, and relevant `performance_context.phase_summaries` (codebase_analysis, bottleneck_analysis, clarifications). Output: `implementation/spec.md`.

**SELF-CHECK**: Did you just invoke the Task tool with `specification-creator`? Or did you start writing spec.md yourself? If the latter, STOP and invoke the Task tool.

### Diagram Refinement (part of `spec-written`, Skill, content-preserving)

Skill tool - `diagrams-mermaid` on `implementation/spec.md`. Add diagrams that clarify bottleneck flows and optimization boundaries without replacing specification prose: `flowchart` (bottleneck → fix path), optional `sequenceDiagram` (key hot path). Missing context → add an explicit open-questions section instead of inventing entities.

### Specification Audit (`spec-audited`, conditional)

> **ANTI-PATTERN — never audit the specification yourself. "The spec is short" is NOT a reason to skip delegation.**
>
> - ❌ "Let me review the spec myself..." — STOP. Delegate to `spec-auditor`.
> - ❌ "I'll check the spec against the analysis..." — STOP. Delegate to `spec-auditor`.

1. If `options.spec_audit_enabled` is already `true` (resume with `verification/spec-audit.md` missing), skip the question and go to step 2. Otherwise `question` — "Run specification audit? (Recommended)" with "Yes, run audit (Recommended)" first. Pre-select the recommended option when the monolith threshold is met: more than 5 optimizations planned or the spec exceeds 50 lines. The user may skip.
2. If yes: **INVOKE NOW** (Task tool): Task tool - `spec-auditor` subagent. Pass (Pattern 7 — accumulated context): task_path, spec_path (`implementation/spec.md`), plus the bottleneck priorities and spec summary from `performance_context.phase_summaries.specification` for framing. Output: `verification/spec-audit.md`. Display the verdict (pass / pass-with-concerns / fail), issue counts by severity, and top critical findings.
3. **SELF-CHECK**: Did you just invoke the Task tool with `spec-auditor`? Or did you review the spec yourself? If the latter, STOP and invoke the Task tool.

**The audit verdict has no separate state slot** — it is recorded in `performance_context.phase_summaries.specification` (the same slot as the spec summary).

## State Update Convention (per step)

Apply after EVERY step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the step slug actually performed plus that step's fields. Never batch multiple steps into one end-of-skill write:
   - After the specification step (`spec-written` complete): append `spec-written` to `completed_phases`; set `performance_context.phase_summaries.specification` (approach + scope summary); bump `orchestrator.updated`.
   - After the audit sub-step (only when it ran): append `spec-audited` to `completed_phases`; set `options.spec_audit_enabled: true` and the audit verdict in `performance_context.phase_summaries.specification`; bump `orchestrator.updated`.
   - When the user skips the audit: set `options.spec_audit_enabled: false` and note "audit skipped" in `performance_context.phase_summaries.specification` — **no `spec-audited` entry**.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the specification or audit fails and cannot be recovered, do NOT append to `completed_phases`; instead append the step's slug (`spec-written` or `spec-audited`) to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-performance.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Recovery

| Step                              | Max Attempts | Strategy                                                                        |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| Specification (`spec-written`)    | 2            | Regenerate spec with adjusted requirements                                       |
| Specification Audit (`spec-audited`) | 2         | Re-run the auditor; on repeated failure report the verdict and offer the skip path |

## Exit Gate

Present results, get user confirmation, then hand off (see [Gate Contract](../orchestrator-framework/references/gate-contract.md)). Never auto-invoke the next skill.

### Results box

```markdown
## ✅ PERFORMANCE SPEC COMPLETE — <spec title>

**Approach** — [optimization approach in 1 line]
**Scope** — [N included / M excluded]
**Audit** — [✅ pass / ⚠ pass-with-concerns / ❌ fail / skipped]: [0 critical / N major / N minor]
**Priorities** — [P0/P1/P2/P3 addressed]

**Artifacts**

- `analysis/requirements.md`
- `implementation/spec.md`
- `verification/spec-audit.md` [conditional]
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the specification is good; continue.
- **Adjust** — regenerate the spec with the user's corrections (priorities, constraints, targets), update state and artifacts, re-present the results box.
- **Discuss** — walk through a specific part of the spec (scope boundaries, optimization approach, audit findings) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:performance-spec <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:performance-plan <task-path>` — `required` next: breaks the approved spec into grouped, dependency-ordered task groups. Remaining after: implement → verify → finalize.

**Other options**:

- `/owflow:reviews-spec-audit <task-path>` — `optional` — standalone spec re-audit; does not advance phases (verify results, then re-run `/owflow:performance-spec` adjustments if needed)
- `/owflow:goal-performance <task-path>` — `optional` shortcut: runs all remaining steps in one loop (plan → implement → verify → finalize)

Then STOP.
