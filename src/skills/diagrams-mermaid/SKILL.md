---
name: owflow:diagrams-mermaid
description: Creates Mermaid diagrams for planning flows, component communication, and architecture views, writes them into the target artifact file with context-derived labels, and themes them github-dark by default (github-light for light surfaces). This skill should be used when the user asks for a workflow, interaction, or architecture visualization from provided task context.
argument-hint: "[diagram description] [target file path]"
user-invocable: true
---

# Mermaid Diagram Builder

Generate Mermaid diagrams from task context and write them into the target document. Focus on visual structure and communication flow, not domain invention.

Gates follow the shared contract in [Gate Contract](../orchestrator-framework/references/gate-contract.md) — the "Input & Output Contract" below IS this skill's Exit Gate, and Step 1 (Extract Context) IS the Entry Gate: when the target file or required facts are missing, ask targeted clarification questions (never invent them) before drawing.

## 🚨 Core Rules

1. **Read `references/reference.md`** (located in the `references/` subdirectory of this skill) before generating any diagram — it holds the theme directives, the quick type selector, and the minimal templates.
2. **File-first output** — every diagram is written into the target artifact file. Never return diagrams only in the chat response; a diagram that exists only in context is a failure. If no target file is known, ask for one (Step 1).
3. **Context-derived descriptions** — every diagram section title, node ID, node label, and edge label must be traceable to the provided context/artifact. Placeholder naming (`A`, `B`, `step1`, `TargetSystem`, `SystemA`, `ServiceA`) is forbidden unless the context itself uses those names.
4. **Theme every diagram** — prepend the exact `%%{init: ...}%%` directive from `references/reference.md` as the first line inside the fence. `github-dark` is the default; `github-light` is used only when the target document/surface is light or the user asks. One theme per document; never invent off-palette colors.
5. **Refine, don't replace** — use the current document or task artifact as source material; add visual precision on top of it and keep required narrative sections intact.
6. **Never invent domain context** — if required facts are missing (actors, components, boundaries, protocols, decisions), ask targeted clarification questions before drawing the final diagram.
7. **Fenced `mermaid` blocks only, from the supported types** (non-negotiable):
   - ✅ Allowed fence: ` ```mermaid `
   - ❌ Forbidden fences: ` ```c4plantuml `, ` ```plantuml `, ` ```puml `, ` ```graphviz `, ` ```dot `, ` ```d2 `, or any custom alias.
   - Supported diagram types: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`. Any other Mermaid diagram type is out of scope for this skill.
   - These rules cannot be overridden by user preference, template defaults, or legacy examples.

---

## When to Use

Use this skill when the user wants:

- a planning flow diagram,
- component communication visualization,
- architecture-level mapping,
- phase/state transitions in a workflow.

---

## Input & Output Contract

**Required input**: a target artifact file (e.g. `implementation/spec.md`, `outputs/high-level-design.md`, `.owflow/docs/project/architecture.md`) plus the context sources that describe the subject. The invoking phase normally supplies both; when the target file is missing, ask for it — never guess and never fall back to chat-only output.

**Deliverable**: the target file updated in place (content-preserving — existing prose and sections stay intact; diagrams are inserted at meaningful section points).

**Response** (after writing): a short summary only —

1. **Diagrams written** — type + section title + location per diagram.
2. **Theme applied** — github-dark / github-light.
3. **Open Questions** (only if context is incomplete) — or the explicit gaps recorded in the document.

Do not paste the diagram bodies into the response; the file is the deliverable. Chat-only output is allowed ONLY when the user explicitly asks for it, and must be marked `Not persisted`.

Validation requirement before returning output:

- Every diagram block in the target file uses the `mermaid` fence exactly. Any other fence language is a hard failure.
- Every diagram block starts with the theme directive. A missing directive is a failure.

---

## Workflow

### Step 1: Extract Context (Entry Gate)

Resolve, in order:

1. **Target file** — from the invocation (path given by the calling phase/user). Missing → ask.
2. **Context sources** — task artifacts and the target file itself; extract only explicit facts:
   - scope and objective,
   - participants/components,
   - boundaries (system/service/module),
   - key interactions or state transitions,
   - constraints and non-goals.

If any required field is missing for the chosen diagram type, ask for it.

### Step 2: Infer Diagram Goal

Classify what the user needs:

- **Process logic** -> `flowchart`
- **Time-ordered communication** -> `sequenceDiagram`
- **State transitions / phase gates** -> `stateDiagram-v2`
- **Architecture landscape** -> `flowchart` with `subgraph` boundaries

### Step 3: Infer Detail Level

Choose the minimum sufficient detail for architecture views:

- **Landscape**: external actors/systems plus one boundary `subgraph`.
- **Container/service**: apps/services/datastores as nodes inside boundary `subgraph`s, labeled edges for interfaces.
- **Module/component**: internal components in one container (only when implementation-level planning needs it), nested `subgraph`s.

Do not mix levels in one diagram; split into multiple diagrams when scope grows.

### Step 4: Build Diagram

Apply naming and structure rules:

- Stable IDs, human-readable labels taken from context (Rule 3).
- One concern per diagram (split large scope into multiple diagrams).
- Architecture views: `subgraph` marks the boundary; label edges with the interaction (HTTP, event, file, query).
- For branching logic, use explicit decisions; for interactions use `alt`, `opt`, `par` where needed.
- Orientation: `LR` for wide flows, `TB` for narrow documents.
- Theme directive first (Rule 4); no other style/color directives.

### Step 5: Write to Target File

1. Edit the target artifact in place — never rewrite the document; insert diagram sections at meaningful points (after the prose they illustrate, or under an existing architecture/flow heading).
2. Each diagram gets a short section heading whose wording comes from the context (e.g. `### Registration request flow`), followed by the fenced block.
3. If the target file does not exist yet, create it only when the invoking phase explicitly allows it; otherwise ask.
4. Record gaps (missing context) as an explicit open-questions note in the document, never as invented entities.

### Step 6: Validate Quality

Run this checklist before final output:

- Target file was actually updated (diagram text present in the file).
- Every title/label traceable to context (no placeholders).
- Diagram type matches user intent and is in the supported set.
- Detail level matches planning need (not over/under detailed).
- No speculative domain entities or links.
- Labels are clear and consistent.
- Syntax is parser-safe.
- All diagram blocks fenced with ` ```mermaid ` and each starts with the theme directive (no alternatives, no off-palette colors).

---

## Mermaid Best Practices

1. **Goal-first, syntax-second**: pick the view before drawing nodes.
2. **Small readable views**: split diagrams instead of creating one overloaded graph.
3. **Consistent naming**: keep IDs stable and semantic; labels from context.
4. **Explicit branching/parallelism**: model alternatives and parallel flows clearly.
5. **Boundary discipline**: `subgraph` marks the system/service boundary; do not mix abstraction levels in one diagram.
6. **Theme consistency**: same directive across a document; never encode meaning in color alone.
7. **Parser safety**:
   - quote labels with special characters,
   - avoid reserved or fragile node IDs,
   - avoid custom style/color directives beyond the theme directive.

---

## Anti-Examples (What Not To Do)

1. **Chat-only diagram (critical anti-pattern)**  
   Returning a fenced block in the response while the target file stays unchanged.

2. **Invented domain context (critical anti-pattern)**  
   Adding components, protocols, or dependencies not present in provided context.

3. **Placeholder naming**  
   IDs and labels like `A`, `B`, `step1`, `TargetSystem`, `WebApp` when the context has real names.

4. **Mixed abstraction levels**  
   Combining system landscape and low-level function internals in a single diagram.

5. **Unreadable mega-diagram**  
   Packing too many nodes/edges into one chart without decomposition.

6. **Sequence without temporal semantics**  
   Using `sequenceDiagram` while omitting real call order, branches, or optional paths.

7. **Off-palette styling**  
   Custom `style`/`classDef` colors or a second theme directive fighting the github theme.

8. **Non-Mermaid diagram fence (hard failure)**  
   Returning diagrams in ` ```c4plantuml `, ` ```plantuml `, or any other non-`mermaid` fenced format.

When any anti-pattern appears, stop and refactor the output before returning it.

---

## Architecture View Matrix

| Need                                            | Recommended Type                    | Minimum Inputs                                  |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| Who interacts with the system?                  | `flowchart` + actor/external nodes  | actors, external systems, system boundary       |
| How services/data stores communicate?           | `flowchart` + boundary `subgraph`s  | containers, interfaces, protocols/data flow     |
| How one service/module is internally organized? | `flowchart` + nested `subgraph`s    | container scope, components, internal contracts |

If minimum inputs are missing, ask questions instead of guessing.
