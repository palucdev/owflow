# Project Vision

## Overview
owflow is an OpenCode plugin that turns AI-assisted software development into a structured, spec-driven workflow. It packages 51 skills, 23 subagents, 52 slash commands, orchestrator state machines, and coding-standards management into a single installable npm package.

## Current State
- **Age**: ~5 months (first release 0.1.0 on 2026-05-10, last update 2026-10-08)
- **Status**: Active development, pre-1.0 (v0.6.1)
- **Users**: OpenCode users and plugin/skill authors; open source under MIT, solo-maintained
- **Tech Stack**: TypeScript 5 (strict, ESM) built and tested with Bun, targeting Node ^25; `@opencode-ai/plugin` as the only framework dependency (3 runtime dependencies total)
- **Test posture**: 158 tests passing across 10 suites, ~98% line / 100% function coverage, 0.8 threshold enforced in `bunfig.toml`

## Purpose
AI coding assistants are powerful but unstructured: without a disciplined process, work skips specification, testing, and verification. owflow exists to make a rigorous SDLC the path of least resistance inside OpenCode — enforced phase gates, TDD red/green checkpoints, standards discovery, and auditable task artifacts — without leaving the assistant's context.

## Goals (Next 6-12 Months)
1. **Grow the workflow feature set** — deepen and extend the four workflow types (development, research, performance, migration) with more capable orchestration, quick lanes, and standards automation.
2. **Deterministic gates** — move entry-gate prerequisite checks from agent-executed prose toward deterministic state-query scripts and lifecycle hooks.
3. **Prove the registration contract** — add an integration smoke test that boots the plugin and asserts the registered skill/command/agent surface.
4. **Harden the delivery pipeline** — CI for type-check + tests, correct type declarations, and contributor documentation.

## Evolution
The project began as a single development orchestrator (0.1.0) and has evolved into a composable skill architecture. Each minor release since 0.3.0 decomposed one monolithic orchestrator into a family of standalone subskills: development (0.3.0), research (0.4.2), migration (0.5.0), and performance (0.6.0). Release 0.4.3 replaced 30 static command wrappers with runtime synthesis from skill frontmatter, and `CHANGELOG.md` now records the semver history from 0.1.0 to 0.6.1. All four workflows share the same shape: a routing dispatcher, standalone subskills, and an autonomous `goal-*` wrapper over one state file per task — plus quick lanes (`--quick`, `dev-bugfix`) and a shared orchestrator framework codifying gate contracts and delegation rules. The direction is clear: more workflows, finer-grained steps, and stronger deterministic guarantees — while keeping skills as the single source of truth.
