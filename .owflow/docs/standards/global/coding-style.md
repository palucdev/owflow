## Coding Style

### Naming Consistency
Follow established naming patterns for variables, functions, classes, and files throughout the project.

### Automatic Formatting
Use automated tools to enforce consistent indentation, spacing, and line breaks.

### Descriptive Names
Choose names that clearly communicate intent; avoid cryptic abbreviations or single-letter identifiers outside tight loops.

### Focused Functions
Write functions that do one thing well; smaller functions are easier to read, test, and maintain.

### Uniform Indentation
Standardize on spaces or tabs and enforce with editor/linter settings.

### No Dead Code
Remove unused imports, commented-out blocks, and orphaned functions instead of leaving them behind.

### No Backward Compatibility Unless Required
Avoid extra code paths for backward compatibility unless explicitly needed.

### DRY (Don't Repeat Yourself)
Extract repeated logic into reusable functions or modules.

### TypeScript Strictness and Runtime Target
All source compiles under `strict: true` with `noFallthroughCasesInSwitch`, `noImplicitOverride`, and `noUncheckedIndexedAccess` enabled; handle the `T | undefined` result of every index access. Target ESNext for the Node ^25 engine declared in package.json — do not downgrade target/lib to support older runtimes.

### Kebab-case TypeScript Filenames
Multi-word TypeScript filenames use kebab-case (e.g., `session-compaction.ts`, `agents-config.ts`). The only intentional exceptions are the MCP tool files whose names mirror their registered `tool()` names in snake_case (`fork_task.ts`, `verify_template.ts`) and their tests.

### Project TypeScript Formatting
Use two-space indentation (no tabs), double-quoted strings, terminating semicolons, and trailing commas in multiline literals and arguments.

### Arrow-function const Exports
Export `const` arrow functions, constants, or interfaces; do not use function declarations. Only `src/index.ts` may default-export, and only the plugin factory (documented OpenCode handling policy).
