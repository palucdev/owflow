# Technology Stack

## Overview

This document describes the technology choices and rationale for owflow, an OpenCode plugin distributed via npm.

## Languages

### TypeScript 5 (peer `^5`)

- **Usage**: ~100% of source code (`src/`, 28 modules)
- **Rationale**: The OpenCode plugin API is typed; strict typing protects a logic-heavy registration and state-machine layer; declarations (`dist/index.d.ts`, `dist/tui.d.ts`) are emitted alongside ESM JavaScript
- **Key Features Used**: ESM (`"type": "module"`, NodeNext resolution, explicit `.js` import extensions), `declaration`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `import type`

### Markdown + YAML frontmatter

- **Usage**: The majority of the product surface — 51 skills (`SKILL.md`, ~13.3K lines), 23 agent definitions, 6 maintained commands, 5 templates
- **Rationale**: Skills/agents/commands are declarative content consumed by OpenCode; frontmatter is the single source of truth from which commands are synthesized at runtime

## Frameworks

### Frontend

None. No UI framework, no web assets — this is a plugin library.

### Backend

None. No server framework, HTTP API, or long-running service. The only runtime framework is the OpenCode plugin API:

- **`@opencode-ai/plugin` `^1.18.4`** — plugin entry contract (`Plugin` type), custom tool factory (`tool()`), config mutation and lifecycle hook types

### Testing

- **`bun:test`** — `describe`/`test`/`expect`, `spyOn` module mocking, `beforeEach`/`afterEach`.
- **Bun coverage** — enabled in `bunfig.toml` (text + lcov reporters, threshold 0.8, `dist` and tests ignored).

## Database

None. Persistence is file-based: orchestrator state lives in `orchestrator-state.yml` files under `.owflow/tasks/`, parsed/stringified with the `yaml` package. Task artifacts are markdown. OpenCode configuration is mutated in-memory through the plugin API.

## Build Tools & Package Management

- **Bun** (`bunfig.toml`, `bun.lock`) — dev, build, and test runtime
- **`bun tsc`** — type-check and emit ESM JavaScript + `.d.ts` declarations to `dist/`
- **`scripts/copy-markdowns.js`** — copies skills, agents, commands, and templates into `dist/` (128 markdown assets; the published `dist/` also contains the compiled JS, `.d.ts` declarations, and html-renderer assets — 189 files total in the payload)
- **npm** — publish path only (`prepack` runs the full build as a publish guard); `package-lock.json` has been removed, leaving `bun.lock` as the single lockfile
- **Bun >= 1.3.0** — host engine requirement (`engines` field)

## Build & Runtime Flow

**Type**: `flowchart` — lightweight view of how sources become the published package and reach the host runtime. All facts are from `package.json` scripts and `tsconfig.json`; no runtime services exist.

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "darkMode": true,
    "background": "#0d1117",
    "primaryColor": "#14181e",
    "primaryTextColor": "#e6edf3",
    "primaryBorderColor": "#383d43",
    "lineColor": "#3d444d",
    "arrowheadColor": "#4493f8",
    "textColor": "#e6edf3",
    "tertiaryColor": "#181c22",
    "titleColor": "#e6edf3",
    "edgeLabelBackground": "#0d1117",
    "stateLabelColor": "#e6edf3",
    "noteBkgColor": "#181c22",
    "noteBorderColor": "#3d444d",
    "noteTextColor": "#e6edf3"
  }
}}%%
flowchart TD
  ts["TypeScript sources<br/>(src/**/*.ts)"] --> tsc["bun tsc<br/>strict type-check + ESM emit"]
  tsc --> dist["dist/<br/>compiled JS"]
  md["Markdown assets<br/>(skills, agents, commands, templates)"] --> copy["scripts/copy-markdowns.js"]
  test["bun test<br/>bun:test + coverage ≥ 0.8"] -->|"must pass (build gate)"| copy
  copy --> dist
  dist --> payload["Package payload<br/>dist + README + LICENSE"]
  payload --> publish["npm publish<br/>(prepack runs full build)"]
  publish --> host["OpenCode host (Bun)<br/>loads dist/index.js"]
```

## Infrastructure

### Containerization

None detected.

### CI/CD

None. Build/test gates run only via local `prepack` or the `local-install` script (`bun run build && opencode plugin "$(pwd)" --global --force`). Adding CI is a roadmap item.

### Hosting

npm registry (distribution). No hosted service, database, or cloud infrastructure.

## Development Tools

### Linting & Formatting

None enforced (no ESLint/Prettier/EditorConfig). Style is manual and consistent: 2-space indent, double quotes, semicolons, trailing commas.

### Type Checking

`bun tsc` with strict settings; tests are excluded from emit via tsconfig and have a nested `tsconfig.json` (`noEmit`) for editor support.

## Key Dependencies

| Dependency            | Version         | Role                                                |
| --------------------- | --------------- | --------------------------------------------------- |
| `@opencode-ai/plugin` | `^1.18.4`       | Plugin API, tool factory, lifecycle types           |
| `gray-matter`         | `^4.0.3`        | YAML frontmatter parsing for skills/agents/commands |
| `yaml`                | `^2.4.1`        | Parse/stringify orchestrator state and templates    |
| `@types/bun`          | `^1.3.13` (dev) | Bun API types for tests and tooling                 |

Minimal dependency surface is a deliberate design principle — 3 runtime dependencies.

## Version Management

Semver in `package.json`. `CHANGELOG.md` follows Keep a Changelog and records releases. Version is exposed to the plugin at runtime via `src/utils/plugin-info.ts` (read from `package.json` with an `unknown` fallback).

## Migration Path (for legacy projects)

Not applicable — modern stack throughout (Bun >= 1.3, TypeScript 5). Type declarations (`dist/index.d.ts`, `dist/tui.d.ts`) are emitted at build time via `declaration: true` in `tsconfig.json`.

---

_Last Updated_: 2026-11-11
_Auto-detected_: languages, versions, dependencies, build/test tooling, absence of CI/linting/containers, distribution model — all from repository inspection
