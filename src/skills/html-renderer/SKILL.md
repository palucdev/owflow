---
name: html-renderer
description: Render a markdown plan, idea, RFC, or design note into a self-contained, share-ready HTML file using the warm editorial visual system bundled under `references/`. Use this skill whenever the user asks to "render", "convert", "turn into HTML", "make a nice HTML version", "share this as a page", or "make this look good" for a markdown file containing a plan, proposal, idea, brief, RFC, design note, or pitch — even if they don't explicitly say "HTML". The output is a single .html file with all CSS inlined, written next to the source .md, that visually matches the reference layout in `references/index.html` and uses tokens from `references/tokens.json`.
disable-model-invocation: true
user-invocable: true
---

# HTML Renderer

Turn a markdown plan/idea/RFC into a single self-contained HTML page that follows the warm editorial design system bundled in this skill.

## When to use

The user gives you a markdown file (or pastes markdown) describing a plan, idea, proposal, RFC, design note, or brief, and wants a clean HTML representation they can share. Output is *always* a portable single-file `.html` with the stylesheet inlined — no external assets, no JS.

This skill is opt-in: it does not auto-trigger. The user invokes it explicitly.

## Inputs and outputs

- **Input**: path to a `.md` file (or raw markdown content). If raw markdown is provided, ask for a filename stem.
- **Output**: write `<source-basename>.html` in the same directory as the source `.md`. If the source is `~/notes/q4-plan.md`, output is `~/notes/q4-plan.html`.
- **Self-contained**: inline the full stylesheet inside a single `<style>` block in `<head>`. Do not link to external CSS, fonts (use the font stacks already in tokens — they fall back to system fonts), or images that aren't already in the source. The one allowed external script is Mermaid (see "Mermaid diagrams" below), and only when the source contains at least one ` ```mermaid ` fence.
- **Title**: use the first `# H1` from the markdown as `<title>`; if none, fall back to the file's basename humanized.

## Reference files (read these before writing output)

The `references/` folder is the source of truth for the visual system. Read each file once at the start of a rendering task so the output matches:

- `references/index.html` — canonical reference page showing every component (heading scale, text block, cards, table, diagram, quote, highlights). Use it as the structural template: the output should look like a variant of this page filled with the user's content.
- `references/styles.css` — every `hr-*` class definition. **Copy this verbatim into the inlined `<style>` block** of the output. Do not paraphrase, rewrite, or trim it; the classes you emit in the HTML must resolve against these exact rules.
- `references/tokens.json` — design tokens (colors, spacing, radius, typography). The CSS already consumes these via `:root` variables, so tokens.json is mostly informational — consult it only if the user asks to tweak colors/spacing or when you need to add a new component that should harmonize with existing tokens.

Reuse existing classes and tokens before inventing anything. If the user asks for something genuinely new, declare any new CSS variables in `:root` using the same naming pattern, and keep class names prefixed with `hr-`.

## Workflow

1. **Resolve input**: confirm the source markdown path; read the file.
2. **Load references**: read `references/index.html` (structure), `references/styles.css` (full CSS to inline), and `references/tokens.json` (only if you need token values).
3. **Plan structure**: scan the markdown and decide how to group content into `<section class="hr-section hr-stack">` blocks. Each top-level `##` typically opens a new section.
4. **Map elements** using the mapping table below.
5. **Assemble** a single HTML document:
   - `<!doctype html>` + `<html lang="en">` + `<head>` with `<meta charset>`, `<meta viewport>`, `<title>`, and a `<style>` block containing the *entire* contents of `references/styles.css`.
   - `<body>` containing `<main class="hr-page">` wrapping the sectioned content.
6. **Write** the file as `<basename>.html` next to the source.
7. **Verify**: re-open the output and confirm every `class="hr-..."` you emitted exists in the inlined CSS.

## Markdown → HTML mapping

| Markdown | HTML |
|---|---|
| `# Title` (first one) | `<h1 class="hr-heading-h1">` (also sets `<title>`) |
| `##`, `###`, `####` | `<h2 class="hr-heading-h2">`, `<h3 class="hr-heading-h3">`, `<h4 class="hr-heading-h4">` |
| Eyebrow line (italic small intro before H1, e.g. `_Reference Base_`) | `<span class="hr-heading-eyebrow">` |
| Paragraphs & lists in narrative flow | wrap in `<div class="hr-text-block hr-stack">` |
| Short summary paragraph right under H1 | `<p class="hr-text-muted">` |
| Unordered/ordered lists | plain `<ul>`/`<ol>` inside `hr-text-block` |
| `**bold**` / `*italic*` | `<strong>` / `<em>` |
| Inline `` `code` `` | `<code>` |
| Links `[text](url)` | `<a href="url">text</a>` |
| Horizontal rule `---` | new `<section class="hr-section hr-stack">` (prefer sectioning over `<hr>`) |
| Tables | `<div class="hr-table-wrap"><table class="hr-table">…</table></div>` |
| Blockquote `>` | `<blockquote class="hr-quote">`; if the last line starts with `— `, render as `<footer>` |
| ` ```mermaid ` code fence | `<div class="hr-diagram"><div class="mermaid">…raw mermaid source, **not** HTML-escaped…</div></div>` (also include the Mermaid script described in "Mermaid diagrams" below) |
| Any other fenced code | `<pre><code>…</code></pre>` (escape `<`, `>`, `&`) |
| Admonitions — lines starting with `> [!NOTE]`, `> [!WARNING]`, `> [!IMPORTANT]` (GitHub-style) or sections prefixed `**Note:**`, `**Warning:**`, `**Important:**` | `<aside class="hr-highlight hr-highlight-{note\|warning\|important}">` with `<p class="hr-highlight-title">` for the label |
| Card-like content — a bolded title followed by 1–3 lines, especially in a list of similar items | `<article class="hr-card">` with `<h3 class="hr-card-title">` and `<p class="hr-card-text">`. Wrap multiple cards in `<div class="hr-grid">` (auto-fit). For fixed layouts use `hr-grid-2`, `hr-grid-3`, `hr-grid-4`, `hr-grid-feature` (2fr/1fr/1fr with `hr-card-featured` first), or `hr-grid-sidebar` (2fr/1fr). Mark the most important card as `hr-card-featured`. |
| Tags / labels (e.g. `[Priority]`, `[Default]`) | `<span class="hr-badge">` |

When the markdown is ambiguous (e.g., "is this a card or a paragraph?"), prefer the simpler choice: text block first, cards only when the content is clearly a set of parallel small items.

## Rendering rules

1. Every class you emit must be prefixed `hr-` and must exist in `references/styles.css`. If you need a new one, also add its rule to the inlined `<style>` and (if it relies on a new token) extend `:root`.
2. No inline `style="…"` attributes unless the user explicitly asks for a one-off override.
3. Favor semantic tags (`section`, `article`, `aside`, `blockquote`, `table`, `figure`) and apply `hr-*` classes on top of them.
4. Escape HTML special characters in content (`<`, `>`, `&`) so user prose never breaks the page.
5. **Keep the output a single file with zero external dependencies** — it must render correctly when opened directly in a browser. The one exception is the Mermaid CDN script, which is only injected when ` ```mermaid ` fences are present; users will need network access to see those diagrams render (the raw mermaid source remains in the DOM as a graceful fallback).

## Mermaid diagrams

When the source markdown contains one or more ` ```mermaid ` fences:

1. Render each fence as:
   ```html
   <div class="hr-diagram">
     <div class="mermaid">
   …raw mermaid source, preserved verbatim, NOT HTML-escaped…
     </div>
   </div>
   ```
   Mermaid replaces the inner text with an SVG at page load, so the content must stay as plain text (do not wrap it in `<pre><code>` and do not escape `<`, `>`, `&` — mermaid needs the original characters).
2. Inject the Mermaid script + initializer immediately before `</body>`, exactly once per document:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
   <script>
     window.mermaid &&
       mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
   </script>
   ```
3. If the markdown has no ` ```mermaid ` fences, **do not** add the script — keep the output fully offline.

## Minimal example

Input (`idea.md`):
```markdown
# Lightweight RFC inbox

A small daily ritual to capture half-formed ideas without losing them.

## Why
Ideas evaporate within a day if there's no easy capture path.

## How
- One markdown file per idea
- Rendered to HTML on demand for sharing

> [!NOTE]
> This is intentionally low-tech: no database, no auth.
```

Output (`idea.html`, abbreviated):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lightweight RFC inbox</title>
    <style>/* entire contents of references/styles.css inlined here */</style>
  </head>
  <body>
    <main class="hr-page">
      <section class="hr-section hr-stack">
        <h1 class="hr-heading-h1">Lightweight RFC inbox</h1>
        <p class="hr-text-muted">A small daily ritual to capture half-formed ideas without losing them.</p>
      </section>
      <section class="hr-section hr-stack">
        <h2 class="hr-heading-h2">Why</h2>
        <div class="hr-text-block hr-stack">
          <p>Ideas evaporate within a day if there's no easy capture path.</p>
        </div>
      </section>
      <section class="hr-section hr-stack">
        <h2 class="hr-heading-h2">How</h2>
        <div class="hr-text-block hr-stack">
          <ul>
            <li>One markdown file per idea</li>
            <li>Rendered to HTML on demand for sharing</li>
          </ul>
        </div>
        <aside class="hr-highlight hr-highlight-note">
          <p class="hr-highlight-title">Note</p>
          <p>This is intentionally low-tech: no database, no auth.</p>
        </aside>
      </section>
    </main>
  </body>
</html>
```
