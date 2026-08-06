---
name: rule-reviewer
description: Score an AI rules file on 5 axes and return concrete actionable fixes
argument-hint: "[path/to/rules.md]"
user-invocable: true
---

# Rule reviewer

Score an AI rules file on five axes and return concrete fixes. The file under review is whatever rule-for-AI markdown the user passes in — this skill does not assume CLAUDE.md, AGENTS.md, or any specific tool.

The skill never edits the file. It produces a scorecard. The user decides what to act on.

## Input resolution

**Get the path to the rules file:**

1. If a path is provided as the skill argument, use it directly
2. If no path is provided, use question:
   ```
   "Which rules file should I review? Provide the path."
   ```
3. Do not guess

Supported path formats — absolute, repo-relative, or `@`-prefixed:

- `AGENTS.md`
- `.cursor/rules/api.mdc`
- `src/api/AGENTS.md`
- `.github/copilot-instructions.md`
- `~/.claude/CLAUDE.md`

If the path resolves to a directory, use question to ask which file to review. If it resolves to multiple files (e.g. `**/AGENTS.md`), score them one at a time and report each scorecard separately — do not merge.

If the file does not exist, stop and report the path. Do not invent content.

## What this skill does NOT do

- Does not edit the rules file _unless the user explicitly approves the reorder proposed by Check 5_. The default output is read-only.
- Does not generate a full "fixed version" of the file. At most, Check 5 may move/regroup sections; it never rewrites rule content.
- Does not assume the file's tool target. CLAUDE.md, AGENTS.md, `.mdc`, `.windsurfrules`, custom names — all treated as "a rules-for-AI file".
- Does not score _project content_ (architecture, tech choices, conventions). It scores the _rule artifact's condition_ — the same way a code review scores code, not the product.

## Procedure

1. Read the file in full using the Read tool (if it's > 2000 lines, read in chunks until complete).
2. Compute Checks 1–4.
3. Run Check 5 in its own multi-step flow (5a list → 5b comment → 5c propose → 5d ask via question → 5e atomic-change reminder). The reorder edit, if any, happens here and only with explicit user approval.
4. Print the scorecard in the exact format under "Output format". Include the reorder-proposal summary and the user's decision in the Check 5 findings.
5. Stop. Do not propose further follow-up actions unless the user asks.

---

## The 5 checks

### Check 1 — Length

Count non-empty lines (ignore blank lines and pure separator lines like `---`).

| Lines   | Verdict   | Symbol |
| ------- | --------- | ------ |
| 0–200   | fine      | OK     |
| 201–500 | watch out | WARN   |
| 501+    | warn      | FAIL   |

Why it matters: long rule files crowd out the user's prompt in the context window, and middle-of-file rules get the weakest attention from the model. Length is a proxy for "you're paying context for things the agent doesn't need every session."

For WARN/FAIL, suggest:

- Split per-area rules into nested files closer to their code (e.g. `src/api/AGENTS.md`).
- Replace duplicated docs with `@`-references to the canonical file.
- Drop rules that aren't tied to a recurring agent failure mode.

### Check 2 — Direct code/config snippets

Scan for fenced code blocks (` ``` `) and inline code blocks longer than ~3 lines.

Flag any block that looks like:

- An example component, endpoint, migration, schema, query, bash script or test.
- A configuration file (`tsconfig.json`, `eslintrc`, `package.json`, `wrangler.toml`).
- A migration template or boilerplate that lives elsewhere in the repo.

Do **not** flag:

- Short structural snippets used to define a _format_ the agent must produce (e.g. a 2–4 line error-shape template).
- Command examples (`npm run dev`, `git rebase`, etc.).
- Mermaid/diagram blocks.

For each flagged block, suggest:

- Move the snippet to a real file in the repo.
- Replace the block with a one-line `@`-reference, e.g. `@src/features/users/user.service.ts`, `@docs/api-errors.md`.
- Reason: the example will be wrong in two places at the next refactor; a reference can't drift.

Verdict: OK if 0 flagged blocks · WARN if 1–2 · FAIL if 3+.

### Check 3 — Precise language

Scan for vague intent that cannot be checked against a diff. Common offenders:

- "Write clean code"
- "Follow best practices"
- "Care about quality"
- "Be consistent"
- "Use modern patterns"
- "Make it readable / maintainable / robust"
- "Handle errors properly"
- "Keep things simple"

For every match, **always propose at least one concrete, testable alternative grounded in this project's context**. Never suggest "just delete it" — the author put the line there for a reason; your job is to translate the intent into something a reviewer can check against a diff.

To ground the suggestion, pull signal from:

- the file under review (stack mentioned, naming conventions stated elsewhere, hard rules in other sections),
- nearby paragraphs around the vague phrase (what was the author about to say?),
- visible repo context if available (`package.json`, `tsconfig.json`, framework choice, lint config, sibling rule files).

If the project context truly doesn't suggest anything specific, propose a sensible default for the detected stack and label it **(assumed)** so the author knows to confirm.

Examples (note how each replacement borrows project-specific names/conventions, not generic advice):

| Vague phrase in file        | Project context signal                                  | Grounded testable replacement                                                                                                                     |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Write clean code"          | TypeScript + ESLint mentioned in same file              | "Avoid `any`. Functions over 40 lines must be split. Run `pnpm lint` before committing."                                                          |
| "Handle errors properly"    | Hard rule earlier: API returns `{ error: {...} }` shape | "API handlers must return `{ error: { code, message, context } }` per the shape defined above. Never throw raw."                                  |
| "Be consistent with naming" | File mentions `feature.handler.ts` elsewhere            | "Use `<feature>.handler.ts` (matching the existing handlers in `src/api/`), not `featureHandler.ts`."                                             |
| "Use modern patterns"       | Project uses native JS, no lodash in `package.json`     | "Use native `Array`/`Object` methods. Do not add `lodash` — it's not in `package.json` and we keep it that way."                                  |
| "Make components readable"  | React + Tailwind project                                | "Components over 150 lines must be split. Tailwind classes go through `cn()` for conditionals (assumed — confirm if a different helper is used)." |
| "Keep things simple"        | Python FastAPI service                                  | "Prefer one Pydantic model per request/response. No nested decorators beyond `@router.post` + `@requires_auth`."                                  |

Verdict: OK if 0 vague phrases · WARN if 1–3 · FAIL if 4+.

Verdict: OK if 0 vague phrases · WARN if 1–3 · FAIL if 4+.

### Check 4 — Redundant knowledge

You are the actor agent reviewing this file. Read it the way you'd read it at the start of a session and ask one question after each paragraph:

> **"Did I already know this before I opened the file?"**

If the answer is "yes, this is in my training data" or "yes, this is the framework's documented default" or "yes, the README/lint config already says this" — flag it. The author paid context for something you didn't need explained.

Use these self-checks while scanning:

- **The "no surprise" test.** Could you have produced this paragraph yourself if asked, with no project access? If yes — redundant.
- **The "framework default" test.** Is the rule restating something the framework, the lint config, the type checker, or the test runner already enforces (e.g. "use TypeScript strict mode", "use `useEffect` cleanup", "FastAPI uses Pydantic for validation", "PostgreSQL supports JSONB")? If yes — redundant. The tool will catch the violation; the prose won't add anything.
- **The "definition" test.** Does the paragraph define a generic engineering term ("what is a service layer", "what REST is", "what hooks are", "what JSX is", "what is `Decimal`")? You know these. Flag and delete.
- **The "could be a link" test.** Does it duplicate `README.md`, `package.json` scripts, the project layout, or `.eslintrc` settings? If yes — replace with `@README.md` / `@package.json` / `@.eslintrc.json`. A reference doesn't drift; copied prose does.
- **The "tutorial smell" test.** If the paragraph reads like a section from the framework's "Getting Started" page or a Medium article — it's tutorial content, not project knowledge. You read those during training.

What is **not** redundant (don't flag):

- Project-specific conventions that contradict the framework default ("we use `useEffect` only for non-data side effects").
- Local pitfalls and historical workarounds you couldn't infer from the code ("the `events` table is partitioned by month — bulk inserts to the wrong partition fail silently").
- Internal naming, layout, or workflow rules ("postings live in `<verb>_<noun>.posting.ts`").
- Rules that look generic but are tied to a real incident (the file should mention the incident or link to a failure-modes register).

For each flagged paragraph, suggest one of:

- **Delete it** — you already knew it.
- **Replace with `@`-reference** — `@README.md`, `@tsconfig.json`, `@docs/...`.
- **Keep only if backed by an incident** — and if so, ask the author to add the incident note inline so the rule survives future audits.

Verdict: OK if 0 redundant paragraphs · WARN if 1–3 · FAIL if 4+.

### Check 5 — Rule ordering

Models pay more attention to the start and end of long contexts ("U-shaped attention"). Critical rules buried in the middle of a long file are statistically less likely to be followed. This check has its own multi-step flow because reordering a file is a meaningful edit, not a one-line fix.

Run the steps in order. The result of this check goes into the scorecard _and_ may trigger an interactive reorder.

#### Step 5a — List the current high-level order

Walk the file and print the current top-level structure as a numbered list. Use H1/H2 headings (and H3s only if there are no H2s). Include the line number of each heading. Do **not** comment yet — just lay out what's there.

Example:

```
Current order:
1. # Welcome to OrderFlow (line 1)
2. ## About the team (line 5)
3. ## Project mission (line 9)
4. ## Our values (line 13)
5. ## Tech stack (line 22)
6. ## Setup (line 36)
7. ## TypeScript (line 78)
...
N. ## Project conventions (line 312)
```

If the file has no headings, say so explicitly: _"No section headings — file is one undifferentiated block."_

#### Step 5b — Comment on the order

Now annotate the list. For each section, give it a short tag and a one-line note. Use these tags:

- **CRITICAL** — load-bearing rule (security, money, irreversibility, project-specific "never do X").
- **USEFUL** — real project knowledge that helps but isn't a tripwire.
- **INTRO** — welcome/mission/team — lowers signal density at the top.
- **REDUNDANT** — already flagged in Check 4 (framework defaults, definitions, tutorial content).
- **VAGUE** — already flagged in Check 3.
- **REFERENCE** — points to other files via `@`-syntax (cheap, fine anywhere).

Then state the structural problem in one paragraph. Examples:

> "Critical security and tenancy rules are at the bottom (line 312). The first 35 lines are INTRO/values/marketing, which the model will weight heavily but which contain no actionable rules. Risk: the agent reads the bloat fully and skims past the rules that actually matter."

> "Order is roughly correct — hard rules at top, conventions in the middle, references at the bottom. One INTRO paragraph at line 1 could be tightened, but no structural reshuffle needed."

#### Step 5c — Propose a better order (only if needed)

If the comment in 5b identified a real problem, propose a target order. Frame it as _"sections moved to top / kept / moved to bottom / removed"_, not as a full rewrite of every line.

Example:

```
Proposed order:
1. ## Hard rules (was: line 312) ← moved to top
2. ## Project conventions (was: line 312, split) ← moved up
3. ## Tech stack (was: line 22) ← kept
4. ## Setup (was: line 36) ← kept, replace with @README.md if possible
5. ## Failure modes (new section) ← collect incident-driven rules here
— ## About the team / Mission / Values ← remove (Check 3/4 already flagged these)
```

If 5b found no problem, skip 5c entirely — say _"Order is sound; no reshuffle needed."_

#### Step 5d — Ask before reordering

If 5c produced a proposal, use question before touching the file:

- Question: "Check 5 proposes reordering sections. How would you like to proceed?"
- Options:
  1. "Yes, reorder the file now" — apply the proposed structure, preserve all rule content, only move/regroup sections.
  2. "Only move the critical rules to the top" — minimal change: lift hard rules to the top, leave the rest alone.
  3. "Show me the diff first" — produce the reordered file as a preview block in chat, no write.
  4. "No, just leave the suggestion in the report" — don't edit the file; the scorecard stands.

If the user picks an editing option, apply it with care: preserve every byte of rule content (only headings and section blocks move), and write a single edit. If the user picks "leave the suggestion", do nothing.

#### Step 5e — Atomic-change reminder

Always end Check 5 with this reminder, regardless of whether a reorder happened:

> **Test each change in your next agent session.** Reordering a rules file is a context-shape change — its effect on agent behavior only shows up the next time you run a real task. Apply changes one at a time (atomic): reorder, then run a representative task, then move on to the next change (split, dedupe, rewrite). Bundling multiple structural changes makes it impossible to attribute a behavior shift to a specific edit.

#### Verdict

Score the file before any reorder happens, based on the original order:

- **OK** — top of file is dense with CRITICAL/USEFUL rules, clear headings, no INTRO bloat at the start.
- **WARN** — structure is mixed: some critical rules at top, others buried; or non-trivial INTRO at the start.
- **FAIL** — critical rules appear after line 200, or the file has no headings at all, or the top 30+ lines are pure INTRO/marketing.

---

## Output format

Print exactly this, in this order. Use Polish or English matching the user's prompt language. Reference `path:line` for every concrete finding so the user can jump straight to it.

```
# Rule Review — <path>

**Overall:** <one-line summary, e.g. "Healthy file with two redundancy hotspots" or "Long, vague, and bottom-heavy — needs a split">

## Scorecard

| # | Check | Verdict | Score |
|---|---|---|---|
| 1 | Length | OK/WARN/FAIL | <n> non-blank lines |
| 2 | Direct snippets | OK/WARN/FAIL | <n> flagged blocks |
| 3 | Precise language | OK/WARN/FAIL | <n> vague phrases |
| 4 | Redundant knowledge | OK/WARN/FAIL | <n> redundant rules |
| 5 | Rule ordering | OK/WARN/FAIL | <one-line reason> |

## Findings

### 1. Length — <verdict>
- <n> non-blank lines.
- <suggestion if WARN/FAIL, otherwise omit>

### 2. Direct snippets — <verdict>
- `path:line-range` — <what kind of snippet> → suggest `@<file>` reference.
- ...

### 3. Precise language — <verdict>
- `path:line` — "<vague phrase>" → "<testable rewrite>"
- ...

### 4. Redundant knowledge — <verdict>
- `path:line` — <what's redundant> → <delete | replace with @reference | keep only if backed by an incident>
- ...

### 5. Rule ordering — <verdict>
- <structural observation, e.g. "Critical security rule at line 287, intro fluff lines 1–42">
- <suggestion>

## Top 3 actions
1. <highest-leverage fix>
2. <second>
3. <third>
```

If a check is OK, still list it in the table but skip the "Findings" subsection (write `### N. <name> — OK` and one short line, nothing more).

The "Top 3 actions" must be ordered by leverage, not by check number. Pick from across all five checks.

---

## Edge cases

- **File under 50 lines:** still run all five checks. Short files often fail Check 3 (vague) and Check 4 (redundant) the most.
- **File is mostly references (`@…`) and few inline rules:** that's a good sign for Checks 2 and 4. Don't penalize it.
- **File is a `.mdc` with frontmatter (`globs:`, `alwaysApply:`):** count rule lines from after the frontmatter. The frontmatter itself is configuration, not rule content.
- **File is a generated stub from `/init` and untouched:** still review it. Often Check 4 (redundant) will dominate — that's the signal to clean it.
- **Multiple rule files in the project:** review the one passed in. Mention sibling files in "Top 3 actions" only if relevant (e.g. duplication between root `AGENTS.md` and a nested one).
