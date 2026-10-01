## Development Conventions

### Predictable Structure
Organize files and directories in a logical, navigable layout.

### Up-to-Date Documentation
Keep README files current with setup steps, architecture overview, and contribution guidelines.

### Clean Version Control
Write clear commit messages, use feature branches, and add meaningful descriptions to pull requests.

### Environment Variables
Store configuration in environment variables; never commit secrets or API keys.

### Minimal Dependencies
Keep dependencies lean and up-to-date; document why major ones are included.

### Consistent Reviews
Follow a defined code review process with clear expectations for reviewers and authors.

### Testing Standards
Define required test coverage (unit, integration, etc.) before merging.

### Feature Flags
Use flags for incomplete features instead of long-lived branches.

### Changelog Updates
Maintain a changelog or release notes for significant changes.

### Build What's Needed
Avoid speculative code and "just in case" additions (see minimal-implementation.md).

### ESM Import Discipline
Use the `node:` prefix for Node builtins, explicit `.js` extensions on relative imports (NodeNext resolution), and `import type`/`export type` for type-only imports (`verbatimModuleSyntax` is enabled).

### [owflow] Logging Prefix
Prefix every `console.log`/`console.warn` message emitted by the plugin with `[owflow]`.

### Minimal Runtime Dependency Surface
Keep runtime dependencies to the declared set (`@opencode-ai/plugin`, `gray-matter`, `yaml`); `typescript` stays a peerDependency, not a runtime dependency. Adding a runtime dependency requires explicit justification.

### Dependency Injection for Testability
Exported entry points accept collaborators and environment paths as parameters with sensible defaults (e.g., `readPluginVersion(pluginRoot = PLUGIN_ROOT)`, `forkTask({ cwd })`) instead of reaching for module globals, so `spyOn`-based tests remain possible.

### Documentation-First and INDEX Maintenance
Check `@.owflow/docs/INDEX.md` before and during work; reference documentation in `.owflow/docs/` is the source of truth for understanding the project. Update `INDEX.md` whenever documentation or standards are added, removed, or significantly changed.

### Task Directory Artifact Anchoring
ALL workflow artifacts (reports, documentation, screenshots) belong under the task directory (`.owflow/tasks/[type]/[task-name]/`). Never write task artifacts to `docs/`, `src/`, or the project root.

### No Plan Mode with Workflows
Do not start workflows in OpenCode plan mode. Planning is built into every workflow, and plan mode's file-creation restriction conflicts with the specs, plans, and artifacts the workflow must create.

### Destructive Command Protection
Destructive bash commands (`git stash`, `git reset --hard`, `git checkout .`, `git clean`, `git push --force`, `rm -rf`) are blocked for non-whitelisted agents, including the main agent. Do not expand the whitelist (`task-group-implementer`, `test-suite-runner`, `e2e-test-verifier`, `user-docs-generator`, `docs-operator`) casually.

### User-Confirmed Rollback Only
Never automatically roll back or revert code changes without explicit user confirmation. On failure: STOP, analyze the root cause, check for an easy config/setup fix, ask the user via the question tool, and execute a rollback only when the user confirms.
