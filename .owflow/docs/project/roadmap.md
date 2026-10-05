# Development Roadmap

## Current State
- **Version**: 0.6.0 (pre-1.0)
- **Key Features**: 4 workflow types (development, research, performance, migration); 51 skills (46 user-invocable); 23 subagents; 52 commands (6 maintained, 46 synthesized from skill frontmatter); 2 custom tools (`verify_template`, `fork_task`); destructive-command guard; task state machine with resume semantics; `.owflow/docs/` standards management
- **Recent Updates**: split the research, migration, and performance orchestrators into standalone subskills; dynamic command wrappers from skill frontmatter; entry-gate hooks for dev skills (git history, Sep 2026)

## Planned Enhancements (Next 3-6 Months)

### High Priority
- [ ] **OpenCode v2 support** — port the plugin to the V2 plugin API (`Plugin.define` + `setup(ctx)`, domain hooks and transforms) while keeping the V1 entrypoint working for `^1.18.x`; verify hooks, both custom tools, and registration end-to-end on V2
- [ ] **Deterministic entry-gate checks** — implement the state-query script + lifecycle hook noted as the future direction in the orchestrator framework docs; today entry-gate prerequisite checks are agent-executed prose and can be skipped or misread
- [ ] **New workflow capabilities** — continue growing the feature set per project goal: extend quick lanes, deepen subskill composition, and add richer standards automation

### Medium Priority
- [ ] **CI pipeline** — run `bun run build` (type-check + tests + coverage) on push/PR for the GitHub/Codeberg remotes
- [ ] **Fix type declarations** — `package.json` declares `types: dist/index.d.ts`, but tsconfig never emits declarations; enable `declaration` or remove the field
- [ ] **CHANGELOG and CONTRIBUTING** — release notes keyed to semver and a guide for adding skills/agents/commands; document Bun as the canonical contributor toolchain
- [ ] **Document plugin internals** — architecture doc for the registration flow and workflow state machine is now available in `.owflow/docs/project/architecture.md`; link it from README

### Technical Debt
- [ ] **`.gitattributes` + formatter** — committed blobs are LF while the working tree is CRLF with no normalization; add `* text=auto eol=lf` and consider Prettier/ESLint
- [ ] **Dual lockfiles** — `bun.lock` and `package-lock.json` are both committed; clarify the canonical package manager or drop one
- [ ] **Hook hardening** — log swallowed non-`Blocked:` hook errors behind a debug flag; bound or clean the per-session agent map in `chat.message`

## Future Considerations
- **Feature Ideas**: additional workflow types, richer fork/merge utilities for research trees, generated docs counts to prevent prose drift, ADR records for major design choices (markdown-defined workflows, runtime command synthesis, skill-vs-agent delegation)
- **Scalability**: skills corpus is ~11.4K lines of markdown; consider index/lazy-loading patterns in the orchestrator framework as the surface grows
