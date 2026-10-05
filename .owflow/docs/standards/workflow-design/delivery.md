## Delivery and Publishing

### Build Gate: Type-Check, Tests, then Asset Copy
`bun run build` is the single release gate: clean `dist/`, run the type-check (`bun tsc`), run the test suite (`bun test src`), then copy markdown assets (skills, agents, commands, templates) into `dist/`. Never publish or hand off without a passing build; keep the copy step the only mechanism that materializes markdown into `dist/`.

### Published Artifact Boundary (dist Only)
Only compiled `dist/`, `README.md`, and `LICENSE` are published (`package.json` `files`), and main/exports/types all resolve into `dist/`. Source markdown ships only after the build copies it into `dist/` — never reference `src/` paths from published entry points.

### Release Hygiene: Semver and Changelog
User-visible or contract-affecting changes bump the `package.json` version and add a root `CHANGELOG.md` entry in Keep a Changelog form (Added / Changed / Notes), including an upgrade note when legacy task state stops being resumable (e.g., pre-split `phase-N` tasks restart from the workflow entry command).
