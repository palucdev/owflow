# Development Roadmap

## Current State
- **Version**: 0.6.0 (pre-1.0)
- **Key Features**: 4 workflow types (development, research, performance, migration); 51 skills (46 user-invocable, 5 internal); 23 subagents; 52 commands (6 maintained, 46 synthesized from skill frontmatter); 2 custom tools (`verify_template`, `fork_task`); destructive-command guard; task state machine with resume semantics; `.owflow/docs/` standards management
- **Recent Updates**: 0.6.0 split the performance orchestrator into 6 `performance-*` subskills (state re-keyed to 9 descriptive slugs, dispatcher trimmed 437 → 267 lines); 0.5.0 split migration into 8 subskills and introduced project docs under `.owflow/docs/`; 0.4.3 replaced 30 static command wrappers with runtime synthesis from skill frontmatter; 0.4.2 split research. All four workflows now share the dispatcher + subskill + `goal-*` architecture.

## Planned Enhancements (Next 3-6 Months)

### High Priority
- [ ] **OpenCode v2 support** — port the plugin to the V2 plugin API (`Plugin.define` + `setup(ctx)`, domain hooks and transforms) while keeping the V1 entrypoint working for `^1.18.x`; verify hooks, both custom tools, and registration end-to-end on V2
- [ ] **Deterministic entry-gate checks** — implement the state-query script + lifecycle hook noted as the future direction in the orchestrator framework docs; today entry-gate prerequisite checks are agent-executed prose and can be skipped or misread
- [ ] **New workflow capabilities** — continue growing the feature set per project goal: extend quick lanes, deepen subskill composition, and add richer standards automation

### Medium Priority
- [ ] **CI pipeline** — run `bun run build` (type-check + tests + coverage) on push/PR for the GitHub/Codeberg remotes
- [ ] **Fix type declarations** — `package.json` declares `types: dist/index.d.ts`, but tsconfig never emits declarations and `dist/index.d.ts` is confirmed missing; enable `declaration` or remove the field
- [ ] **CONTRIBUTING guide** — the CHANGELOG now exists (Keep a Changelog format, 0.1.0 → 0.6.0); what remains is a guide for adding skills/agents/commands and documenting Bun as the canonical contributor toolchain
- [ ] **Document plugin internals** — architecture doc for the registration flow and workflow state machine is available in `.owflow/docs/project/architecture.md`; link it from README
- [x] **Sync `docs/commands.md`** — resolved: the six `/owflow:performance-*` subcommands are now documented for parity with the migration subcommands (2026-10-05)

### Technical Debt
- [ ] **`.gitattributes` + formatter** — committed blobs are LF while the working tree is CRLF with no normalization (`commands-config.ts` compensates by emitting CRLF); add `* text=auto eol=lf` and consider Prettier/ESLint
- [x] **Dual lockfiles** — resolved: only `bun.lock` remains in the tree (`package-lock.json` removed, 2026-10)
- [ ] **Hook hardening** — log swallowed non-`Blocked:` hook errors behind a debug flag; bound or clean the per-session agent map in `chat.message`
- [ ] **Agent frontmatter consistency** — `src/agents/project-analyzer.md` lacks the `model: inherit` field present on the other 22 agents

## Future Considerations
- **Feature Ideas**: additional workflow types, richer fork/merge utilities for research trees, generated docs counts to prevent prose drift, ADR records for major design choices (markdown-defined workflows, runtime command synthesis, skill-vs-agent delegation)
- **Scalability**: the skills corpus is now ~13.3K lines of markdown (up from ~11.4K); consider index/lazy-loading patterns in the orchestrator framework as the surface grows
