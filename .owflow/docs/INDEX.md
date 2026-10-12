# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Project Documentation

Project-level documentation covering vision, goals, architecture, and technology choices.

### Technical Standards

Coding standards, conventions, and best practices organized by domain.

---

## Project Documentation

Located in `.owflow/docs/project/`

### Vision (`project/vision.md`)

Project purpose and current state: mission (make a rigorous, spec-driven SDLC the path of least resistance inside OpenCode), status (v0.6.1, pre-1.0, solo-maintained MIT), package surface (51 skills, 23 subagents, 52 commands), test posture (158 tests across 10 suites, ~98% line / 100% function coverage), 6–12 month goals (grow workflow features, deterministic gates, registration smoke test, CI/type declarations), and evolution to four decomposed workflows (development 0.3.0, research 0.4.2, migration 0.5.0, performance 0.6.0) sharing dispatcher + subskill + `goal-*` architecture.

### Roadmap (`project/roadmap.md`)

v0.6.1 feature inventory (4 workflows, 51 skills, 23 subagents, 52 commands, 2 custom tools) with recent-update history; high-priority plans (OpenCode v2 port, deterministic entry-gate checks, new workflow capabilities); medium-priority plans (GitHub Actions CI added 2026-10-08 — Codeberg runner pending, type declarations, CONTRIBUTING, internals docs, performance-command docs parity); technical debt (`.gitattributes`/formatter, hook hardening, agent frontmatter consistency; dual lockfiles resolved); and future considerations (ADR records, generated docs counts, skill-corpus scaling).

### Tech Stack (`project/tech-stack.md`)

Languages (TypeScript 5 strict ESM; markdown + YAML frontmatter product surface: 51 skills, ~13.3K lines), Bun/Node tooling (single `bun.lock`), three runtime dependencies, build & runtime flow diagram, testing (bun:test, 158 tests across 10 suites, coverage ≥ 0.8), dist payload (149 files), version management, and infrastructure (GitHub Actions CI added 2026-10-08; no DB, containers, or network services).

### Architecture (`project/architecture.md`)

Runtime plugin lifecycle (entry, config mutation, hooks, custom tools), markdown-defined workflow engine with per-task state machine — all four workflows decomposed (dispatcher + subskills + autonomous `goal-*` wrapper) with per-workflow slug counts (development 13, migration 10, performance 9, research 8); layered system structure, distribution/context diagram, data flow, and invocation sequence diagram.

---

## Technical Standards

### Global Standards

Located in `.owflow/docs/standards/global/`

These standards apply across the entire codebase, regardless of frontend/backend context.

#### Error Handling (`standards/global/error-handling.md`)

Plugin contracts use machine-readable error prefixes (`INVALID_NAME:`, `Blocked:`), never throw from `tool()` handlers (return `{ output }` instead), degrade gracefully on optional or external input, and carry actionable `Hint:` guidance when an error is meant to drive agent behavior.

#### Development Conventions (`standards/global/conventions.md`)

ESM import discipline (`node:` prefix, explicit `.js` extensions, `import type`), `[owflow]` logging prefix, pinned runtime dependency surface (`typescript` as peerDependency), dependency injection for testability, documentation-first with INDEX maintenance, task-directory artifact anchoring, no plan mode with workflows, destructive-command protection whitelist, and user-confirmed rollback only.

#### Coding Style (`standards/global/coding-style.md`)

TypeScript specifics: `strict` with `noFallthroughCasesInSwitch`/`noImplicitOverride`/`noUncheckedIndexedAccess`, ESNext target for Node ^25, kebab-case filenames (snake_case MCP tool exceptions), two-space/double-quote/semicolon/trailing-comma formatting, and `const` arrow-function exports with no function declarations.

#### Commenting (`standards/global/commenting.md`)

Sparse (~10% of lines) rationale-only comments, no TODO/FIXME/HACK markers, no commented-out code.

---

### Frontend Standards

_Not initialized for this project. If you need frontend standards, you can:_

- _Add them manually using the owflow:docs-manager skill_
- _Run `/owflow:standards-discover --scope=frontend` to auto-discover_

---

### Backend Standards

_Not initialized for this project. If you need backend standards, you can:_

- _Add them manually using the owflow:docs-manager skill_
- _Run `/owflow:standards-discover --scope=backend` to auto-discover_

---

### Testing Standards

Located in `.owflow/docs/standards/testing/`

These standards apply to all testing code (unit, integration, E2E).

#### Test Writing (`standards/testing/test-writing.md`)

TDD red gate before any fix (quick lanes included), incremental verification of only new tests after each task group, full suite plus verification report before commit with per-subskill retry budgets (dev-verify: 3, dev-finalize: 3), and behavior-descriptive `should …` test names.

#### Test Organization (`standards/testing/test-organization.md`)

`bun:test` only, tests mirrored under `src/__tests__/` with cross-cutting fixtures in `src/__tests__/fixtures/<tool>/`, tests excluded from the root tsconfig build via a nested `noEmit` config, 0.8 coverage gate (text + lcov reporters, `dist/**` and tests ignored), per-test temp directories via `mkdtempSync` removed in `afterEach`, and every `spyOn` paired with `mockRestore()`.

---

### Workflow Design Standards

Located in `.owflow/docs/standards/workflow-design/`

Project-specific workflow design conventions (orchestrator flows, skill/agent boundaries, state contracts, delivery) maintained as focused topic files.

#### Overview (`standards/workflow-design/README.md`)

Category overview: custom project workflow-design standards category (no built-in seed standards); add new standards as topic files in this directory, then index them here.

#### Skill, Agent, and Command Authoring (`standards/workflow-design/authoring.md`)

SKILL.md frontmatter/naming contract (always `owflow:`-prefixed, `user-invocable` flags), agent frontmatter contract (`mode: subagent`, `hidden: true`, inherited model), thin command wrappers over skills, runtime synthesis of slash commands from invocable skill frontmatter (`argument-hint` is documentation-only; behavior-changing flags are restated in skill bodies), anti-duplication and single source of truth, documentation length targets, references that guide rather than implement (<10-line examples), reference file placement, HR-separated agent bodies with YAML result blocks, and structured workflow/step documentation.

#### State Management and Gates (`standards/workflow-design/state-and-gates.md`)

Entry/Exit Gate contract with state marked complete only after the user's gate response, `orchestrator-state.yml` canonical with stable descriptive step slugs (task system mirrors for UX), `verify_template` validation after state creation/update, shared schema across orchestrator state templates, and post-compaction state re-read.

#### Delegation (`standards/workflow-design/delegation.md`)

Always delegate via the Skill/Task tools (never inline), companion-agent pattern only for non-spawning skills, accumulated context passing with `phase_summaries` extraction, and a hard requirement to surface `decisions_needed` via the question tool — never silently accept defaults.

#### Orchestration (`standards/workflow-design/orchestration.md`)

Subskills never auto-chain (suggest next command and stop), standalone task resolution with structured blocked-prerequisite output, orchestrator creation checklist compliance, user-approved spec before implementation planning, and continuous standards discovery at spec, task-group start, and pre-report.

#### Workflow Behavior (`standards/workflow-design/workflow-behavior.md`)

`YYYY-MM-DD-task-name` task directories, skill invocation as the first action, quick lanes (`--quick` flags on dev-spec/dev-plan/dev-implement, plus dedicated `dev-bugfix`/`research-quick` skills; none for migration/performance) producing standard continuable tasks, mandatory rollback planning for migrations, fix-then-reverify loops with critical issues blocking progression, invocation-driven optional research chain (no enablement flag), and read-only review/audit commands.

#### Delivery and Publishing (`standards/workflow-design/delivery.md`)

Single release gate (`bun run build`: clean `dist/`, type-check, tests, then copy markdown assets) and a published artifact boundary — only `dist/`, `README.md`, and `LICENSE` ship, with published entry points never referencing `src/`; release hygiene pairs a semver bump with a Keep a Changelog entry (Added/Changed/Notes) and upgrade notes when legacy task state stops being resumable.

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Project Context**: Read relevant project documentation before starting work
3. **Standards**: Reference appropriate standards when writing code
4. **Keep Updated**: Update documentation when making significant changes
5. **Customize**: Adapt all documentation to your project's specific needs

## Updating Documentation

- Project documentation should be updated when goals, tech stack, or architecture changes
- Technical standards should be updated when team conventions evolve
- Always update INDEX.md when adding, removing, or significantly changing documentation

---

**Last Generated**: 2026-10-05
**Maintained by**: Documentation Manager skill
