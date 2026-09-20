---
name: owflow:dev-spec
description: Development — technical approach, requirements gathering, specification creation, and optional specification audit.
argument-hint: "[task-path-or-identifier]"
user-invocable: true
---

# Dev Spec — Phases 4–5 (Requirements, Specification & Audit)

Work phase of the development workflow. Resolves technical decisions, gathers requirements, creates the specification via delegation, refines it with diagrams, then offers an independent specification audit.

## Entry Gate

Resolve the `task-path-or-identifier` argument BEFORE anything else (see `orchestrator-patterns.md` Section 9):

- **Path** (absolute or project-relative) to the task directory — use as-is.
- **Identifier** — exact directory name inside `.owflow/tasks/development/` (e.g., `2026-01-12-my-task`); resolve to its path.
- If the argument is **missing**, the path does **not exist**, or matches **no identifier** → print the blocked block, then STOP (never guess or auto-pick a task):
  1. Steps that must be completed first (in order), each with its command:
     - Phases 1–2 (codebase & gap analysis) → `/owflow:dev-analyze <task-path>`
     - Phase 3 (TDD red gate) — only when a reproducible defect was detected during analysis → `/owflow:dev-tdd-red <task-path>`
  2. List available dev-task identifiers (directories under `.owflow/tasks/development/`) to resume from, if any.
  3. Hint: `Run /owflow:development <description> to start a task from scratch, or pass a task path/identifier to resume.`

### Prerequisites

| Required for this skill | Where verified                                                                    | Produced by                       |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| State file exists       | `<task-path>/orchestrator-state.yml`                                              | `/owflow:development <desc>`      |
| Analysis done           | `phase-2` in `completed_phases` + `analysis/gap-analysis.md` exists               | `/owflow:dev-analyze <task-path>` |
| TDD red gate (conditional) | `phase-3` in `completed_phases` — required only when `has_reproducible_defect: true` | `/owflow:dev-tdd-red <task-path>` |

1. **Read `orchestrator-state.yml`** from the task path. If missing → print: `No development task found at <path>. Run /owflow:development <description> to start a task from scratch.` and STOP.
2. **Skip/resume**: if `phase-4` is in `completed_phases`, skip to Phase 5; if both `phase-4` and `phase-5` are complete, report existing results and route to the Exit Gate.
3. **Conditional activation (routing guard)**: if `task_context.task_characteristics.has_reproducible_defect` is `true` AND `phase-3` is NOT in `completed_phases` → print the blocked block, then STOP:
   - Steps that must be completed first: Phase 3 (TDD red gate — required because a reproducible defect was detected); if analysis (Phases 1–2) is also missing, start there.
   - `Run /owflow:dev-tdd-red <task-path> first (or /owflow:dev-analyze <task-path> if analysis is also missing).`
4. **Prerequisite check**: `phase-2` in `completed_phases` and `analysis/gap-analysis.md` exists. Otherwise → print the blocked block, then STOP:
   - Steps that must be completed first: Phases 1–2 (codebase & gap analysis).
   - `Run /owflow:dev-analyze <task-path> first.`
   - If no task exists yet: `Run /owflow:development <description> to start a task from scratch.`

## Execute

**Read first**: Section 1 (Delegation Rules) of `../orchestrator-framework/references/orchestrator-patterns.md`.

### Part A — Technical & Architecture Clarification (Phase 4, inline, conditional)

- Complex task with multiple approaches → `question` for 3-5 technical questions.
- Multiple valid architectural approaches → present 2-3 via `question`; the chosen approach is passed to specification-creator.
- Save to `analysis/technical-clarifications.md` (conditional).
- Skip if: simple task, `risk_level: low`, no multiple approaches detected.

### Part B — Requirements Gathering (Phase 4, inline)

1. `question` for specification requirements — adaptive count based on description length: brief (<30 words) 6-8; standard (30-100 words) 4-6; detailed (>100 words) 2-3. Frame as confirmable assumptions ("I assume X, is that correct?").
2. REQUIRED questions (always include): **User Journey** (discovery/access, personas, workflow fit), **Existing Code Reuse** (similar features, UI components, backend patterns), **Visual Assets** (mockups/wireframes → `analysis/visuals/`).
3. Check `analysis/visuals/` for assets regardless of the answer; note findings for subagent context (skip visual processing for non-UI tasks when none found).
4. Save to `analysis/requirements.md`: initial description, all Q&A rounds, similar features, visual insights, functional requirements, reusability opportunities, scope boundaries, technical considerations.

### Part C — Specification Creation (Phase 4, subagent)

**ANTI-PATTERN — never write spec.md yourself. "The task is simple" is NOT a reason to skip delegation.**

Task tool - `specification-creator`. Pass: task_path, task_description, task_characteristics, requirements_path (`analysis/requirements.md`), project_context_paths (INDEX.md + `project_doc_paths` from state), risk_level, relevant `phase_summaries`, research/quick context if present in state. Output: `implementation/spec.md`.

### Part D — Diagram Refinement (Phase 4, Skill, content-preserving)

Skill tool - `diagrams-mermaid` on `implementation/spec.md`. Add diagrams that clarify scope and communication without replacing prose: `flowchart` (primary functional path), `sequenceDiagram` (key interaction), optional `C4Component` (if module structure is in scope). Missing context → add an explicit open questions section instead of inventing entities.

### Part E — Specification Audit (Phase 5, recommended)

1. `question` — "Run specification audit? (Recommended)" with "Yes, run audit (Recommended)" first. User may skip.
2. If yes: Task tool - `spec-auditor`. Pass: task_path, spec_path. Output: `verification/spec-audit.md`. Display verdict (pass/pass-with-concerns/fail), issue counts by severity, top critical findings.

## State Update Convention (per step)

Apply after EVERY phase/step above:

1. **Write immediately** — update `orchestrator-state.yml` as soon as the step completes, appending ONLY the `phase-N` entry actually performed plus that step's fields. Never batch multiple phases into one end-of-skill write:
   - After Part A (if it ran): set `task_context.tech_clarified`, `task_context.architecture_decision`.
   - After Parts B–D (Phase 4 complete): append `phase-4` to `completed_phases`; set `phase_summaries.specification`; bump `orchestrator.updated`.
   - After Part E (only when the audit ran): append `phase-5` to `completed_phases`; set `options.spec_audit_enabled: true` and the audit verdict in `phase_summaries.specification`; bump `orchestrator.updated`. When the user skipped the audit, set `options.spec_audit_enabled: false` — no `phase-5` entry.
2. **Timestamp** — set `orchestrator.updated` to the current UTC timestamp on every write.
3. **Failures** — if the spec creation or audit fails and cannot be recovered, do NOT append to `completed_phases`; append the corresponding `phase-N` to `orchestrator.failed_phases` and increment `auto_fix_attempts["phase-N"]`.
4. **Validate** — after every write, re-read the file to confirm values, then run the `verify_template` tool with `filePath: <task-path>/orchestrator-state.yml`, `templateName: orchestrator-state-development.yml`. Fix any reported issue immediately before proceeding.
5. **Final check** — before the Exit Gate, one consolidated re-read + `verify_template` run to confirm the full state matches everything performed in this session.

## Exit Gate

Present results, get user confirmation, then hand off (see `orchestrator-patterns.md` Section 9). Never auto-invoke the next skill.

### Results box

```
═══════════════════════════════════════════════════════
  DEV SPEC COMPLETE: <spec title>
═══════════════════════════════════════════════════════
  Approach:        [architecture approach in 1 line]
  Scope:           [N included / M excluded items]
  Requirements:    [count by kind]
  Assumptions:     [count]
  Audit verdict:   [pass / pass-with-concerns / fail / skipped]

  Artifacts:
    - analysis/technical-clarifications.md   [conditional]
    - analysis/requirements.md
    - implementation/spec.md
    - verification/spec-audit.md             [conditional]
═══════════════════════════════════════════════════════
```

### Results-acceptance question

Use `question` — "Are these results correct?" with options:

- **Accept** — the specification is good; continue.
- **Adjust** — regenerate the spec with the user's corrections (clarifications, scope boundaries, requirements), update state, re-present the results box.
- **Discuss** — walk through a specific part of the spec (scope boundaries, architecture approach, audit findings) in more depth; then re-ask.
- **Stop here** — print the resume command (`/owflow:dev-spec <task-path>`) and end.

### Next steps (after Accept)

- `→ /owflow:dev-plan <task-path>`

**Other options**:

- `/owflow:reviews-spec-audit <task-path>` — standalone re-audit of the spec
- `/owflow:goal-development <task-path>` — continue remaining phases in one loop

Then STOP.
