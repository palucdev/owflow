## Test Organization

### bun:test and Mirrored Test Layout
Tests use `bun:test` exclusively and live under `src/__tests__/`, mirroring the tested module's directory path (e.g., `src/__tests__/hooks/internal/before-tool.test.ts` tests `src/hooks/internal/before-tool.ts`). Cross-cutting fixtures live in `src/__tests__/fixtures/<tool>/`.

### Integration Tests Beside the Mirror
When one module's tests must split across several files to respect the 250-line lint cap, the extra topic files live in `src/__tests__/integration/<module>-<topic>.test.ts` so the mirrored tree stays 1:1 — e.g. `src/__tests__/integration/hooks-wrapper-status.test.ts` and its siblings exercise `src/hooks/hooks-wrapper.ts` alongside the mirrored `src/__tests__/hooks/hooks-wrapper.test.ts`.

### Test Build Isolation
`bun test src` is the runner. Tests and fixtures are excluded from the root tsconfig so `tsc` never emits them into `dist/`; a nested `src/__tests__/tsconfig.json` extends the root config with `noEmit` for editor/type-check parity, and `bun run type-check` runs that project as a second pass after the root project so the CLI gate covers tests too.

### 80% Coverage Gate
Coverage is enabled with a 0.8 threshold, text + lcov reporters, and `dist/**` plus `src/__tests__/**` ignored. Bun enforces the threshold per file — `bun test` exits 1 when any file's line or function coverage falls below it, even when all tests pass.

### Temp-Dir Isolation and Cleanup
Filesystem-touching tests create a per-test temp directory with `fs.mkdtempSync(path.join(os.tmpdir(), "owflow-<name>-test-"))` and remove it in `afterEach` with `fs.rmSync(dir, { recursive: true, force: true })`.

### Platform-Dependent Capabilities
Tests needing symlinks or a real bash interpreter probe them once via `src/__tests__/fixtures/hooks/platform-support.ts` (`supportsSymlinks`, `bashInterpreter`) and gate the affected cases with `test.skipIf` — never hardcode Unix-only interpreter paths like `/bin/bash` when spawning.

### Spy Cleanup
Every `spyOn` is paired with `mockRestore()`, normally inside `try/finally`, so test pollution cannot leak between cases.
