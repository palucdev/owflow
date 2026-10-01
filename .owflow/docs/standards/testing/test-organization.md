## Test Organization

### bun:test and Mirrored Test Layout
Tests use `bun:test` exclusively and live under `src/__tests__/`, mirroring the tested module's directory path (e.g., `src/__tests__/hooks/before-tool.test.ts` tests `src/hooks/before-tool.ts`). Cross-cutting fixtures live in `src/__tests__/fixtures/<tool>/`.

### Test Build Isolation
`bun test src` is the runner. Tests and fixtures are excluded from the root tsconfig so `tsc` never emits them into `dist/`; a nested `src/__tests__/tsconfig.json` extends the root config with `noEmit` to keep editor/type-check parity.

### 80% Coverage Gate
Coverage is enabled with a 0.8 threshold, text + lcov reporters, and `dist/**` plus `src/__tests__/**` ignored. New code must not drop total coverage below the threshold — the test script fails otherwise.

### Temp-Dir Isolation and Cleanup
Filesystem-touching tests create a per-test temp directory with `fs.mkdtempSync(path.join(os.tmpdir(), "owflow-<name>-test-"))` and remove it in `afterEach` with `fs.rmSync(dir, { recursive: true, force: true })`.

### Spy Cleanup
Every `spyOn` is paired with `mockRestore()`, normally inside `try/finally`, so test pollution cannot leak between cases.
