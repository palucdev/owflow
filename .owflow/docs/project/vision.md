# Project Vision

## Overview
owflow is an OpenCode plugin that turns AI-assisted software development into a structured, spec-driven workflow. It packages 35 skills, 23 subagents, 36 slash commands, orchestrator state machines, and coding-standards management into a single installable npm package.

## Current State
- **Age**: ~5 months (first commits 2026-05-10, last update 2026-09-30)
- **Status**: Active development, pre-1.0 (v0.4.3)
- **Users**: OpenCode users and plugin/skill authors; open source under MIT, solo-maintained
- **Tech Stack**: TypeScript 5 (strict, ESM) built and tested with Bun, targeting Node ^25; `@opencode-ai/plugin` as the only framework dependency (3 runtime dependencies total)
- **Test posture**: 141 tests passing, ~98% line coverage, 0.8 threshold enforced in `bunfig.toml`

## Purpose
AI coding assistants are powerful but unstructured: without a disciplined process, work skips specification, testing, and verification. owflow exists to make a rigorous SDLC the path of least resistance inside OpenCode — enforced phase gates, TDD red/green checkpoints, standards discovery, and auditable task artifacts — without leaving the assistant's context.

## Goals (Next 6-12 Months)
1. **Grow the workflow feature set** — deepen and extend the four workflow types (development, research, performance, migration) with more capable orchestration, quick lanes, and standards automation.
2. **Deterministic gates** — move entry-gate prerequisite checks from agent-executed prose toward deterministic state-query scripts and lifecycle hooks.
3. **Prove the registration contract** — add an integration smoke test that boots the plugin and asserts the registered skill/command/agent surface.
4. **Harden the delivery pipeline** — CI for type-check + tests, correct type declarations, and contributor documentation.

## Evolution
The project began as a single development orchestrator and has evolved into a composable skill architecture: orchestrators decomposed into standalone subskills (`dev-*`, `research-*`), two modes per workflow sharing one state file (assisted dispatcher vs. autonomous `goal-*` wrapper), quick lanes (`--quick`, `dev-bugfix`), and a shared orchestrator framework codifying gate contracts and delegation rules. The most recent work split the migration and performance orchestrators into subskills, following the pattern established for development and research. The direction is clear: more workflows, finer-grained steps, and stronger deterministic guarantees — while keeping skills as the single source of truth.
