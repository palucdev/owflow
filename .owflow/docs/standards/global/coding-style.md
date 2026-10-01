## Coding Style

### TypeScript Strictness and Runtime Target
All source compiles under `strict: true` with `noFallthroughCasesInSwitch`, `noImplicitOverride`, and `noUncheckedIndexedAccess` enabled; handle the `T | undefined` result of every index access. Target ESNext for the Node ^25 engine declared in package.json — do not downgrade target/lib to support older runtimes.

### Kebab-case TypeScript Filenames
Multi-word TypeScript filenames use kebab-case (e.g., `session-compaction.ts`, `agents-config.ts`). The only intentional exceptions are the MCP tool files whose names mirror their registered `tool()` names in snake_case (`fork_task.ts`, `verify_template.ts`) and their tests.

### Project TypeScript Formatting
Use two-space indentation (no tabs), double-quoted strings, terminating semicolons, and trailing commas in multiline literals and arguments.

### Arrow-function const Exports
Export `const` arrow functions, constants, or interfaces; do not use function declarations. Only `src/index.ts` may default-export, and only the plugin factory (documented OpenCode handling policy).
