# Development Roadmap

## Current State

- **Version**: 0.7.0 (pre-1.0)
- **Key Features**: 4 workflow types (development, research, performance, migration); 51 skills (46 user-invocable, 5 internal); 23 subagents; 52 commands (6 maintained, 46 synthesized from skill frontmatter); 2 custom tools (`verify_template`, `fork_task`); destructive-command guard; user hooks wrapper (`.owflow/hooks/` `.sh`/`.ps1` subprocess scripts digested and dispatched with guard-first ordering, `owflow-hooks` CLI, always-on TUI Active hooks sidebar panel); task state machine with resume semantics; `.owflow/docs/` standards management
- **Recent Updates**: 0.7.0 adds the `.owflow/hooks/` user hooks wrapper (`.sh`/`.ps1` subprocess scripts dispatched through owflow's handlers guard-first, event-named v1 host event hooks, uniform `owflow-hooks/1` JSON envelope, 13 gate and 3 observe events, `owflow-hooks` CLI, always-on TUI Active hooks sidebar panel with live runtime status and click-to-open run-detail/logs popups, `OWFLOW_HOOKS_DISABLED=1` bypass, opt-in `OWFLOW_HOOK_TIMEOUT_MS`, and `.d.ts` declaration emission); 0.6.1 added file-first `diagrams-mermaid` theming; 0.6.0 split the performance orchestrator into 6 `performance-*` subskills (state re-keyed to 9 descriptive slugs, dispatcher trimmed 437 → 267 lines); 0.5.0 split migration into 8 subskills and introduced project docs under `.owflow/docs/`; 0.4.3 replaced 30 static command wrappers with runtime synthesis from skill frontmatter; 0.4.2 split research. All four workflows now share the dispatcher + subskill + `goal-*` architecture.

## Planned Enhancements (Next 3-6 Months)

### High Priority

- [ ] **OpenCode v2 support** — port the plugin to the V2 plugin API (`Plugin.define` + `setup(ctx)`, domain hooks and transforms) while keeping the V1 entrypoint working for `^1.18.x`; verify hooks, both custom tools, and registration end-to-end on V2. The user hooks wrapper (0.7.0) already ships its execution core behind an internal platform-agnostic seam (`run(entry, envelope) → Outcome`, zero `Plugin`/`Hooks`/`PluginInput` references under `src/hooks-wrapper/`); the staged port targets `@opencode/plugin` 2.0.x (not the `1.18.x` preview), in the order entrypoint/registration → hook subset → transforms → unsupported declarations, gated on pinning 2.0.x and resolving the research's pending unknowns
- [ ] **Deterministic entry-gate checks** — implement the state-query script + lifecycle hook noted as the future direction in the orchestrator framework docs; today entry-gate prerequisite checks are agent-executed prose and can be skipped or misread
- [ ] **New workflow capabilities** — continue growing the feature set per project goal: extend quick lanes, deepen subskill composition, and add richer standards automation

### Medium Priority

- [ ] **CI pipeline** — omitted by design for now; release verification runs locally via the `prepack` build gate (`bun run build`: type-check + tests + coverage)
- [x] **Fix type declarations** — resolved (2026-10-29): `tsconfig.json` now emits `.d.ts` declarations (`dist/index.d.ts`, `dist/tui.d.ts`) and `package.json` `exports` exposes `types` conditions
- [ ] **CONTRIBUTING guide** — the CHANGELOG now exists (Keep a Changelog format, 0.1.0 → 0.7.0); what remains is a guide for adding skills/agents/commands and documenting Bun as the canonical contributor toolchain
- [ ] **Document plugin internals** — architecture doc for the registration flow and workflow state machine is available in `.owflow/docs/project/architecture.md`; link it from README
- [x] **Sync `docs/commands.md`** — resolved: the six `/owflow:performance-*` subcommands are now documented for parity with the migration subcommands (2026-10-05)

### Technical Debt

- [x] **`.gitattributes`** — resolved: `* text=auto eol=lf` normalizes the working tree to LF (2026-10-08; `commands-config.ts` still emits CRLF for rendered command bodies); a formatter (Prettier/ESLint) remains open
- [x] **Dual lockfiles** — resolved: only `bun.lock` remains in the tree (`package-lock.json` removed, 2026-10)
- [x] **Hook hardening** — resolved (2026-10-29): unexpected non-`Blocked:` errors in `tool.execute.before` log a `[owflow] hooks:` warning while failing open, and `agentBySession` is bounded at 256 sessions and cleared on `dispose`
- [ ] **Agent frontmatter consistency** — `src/agents/project-analyzer.md` lacks the `model: inherit` field present on the other 22 agents

## Future Considerations

- **Feature Ideas**: additional workflow types, richer fork/merge utilities for research trees, generated docs counts to prevent prose drift, ADR records for major design choices (markdown-defined workflows, runtime command synthesis, skill-vs-agent delegation)
- **Scalability**: the skills corpus is now ~13.3K lines of markdown (up from ~11.4K); consider index/lazy-loading patterns in the orchestrator framework as the surface grows
