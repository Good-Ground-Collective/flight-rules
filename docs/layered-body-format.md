# Layered Body Format

The body shape every decomposed node (epic, ticket) emitted by `break-down-work`
must follow. It serves three readers from one document:

1. **A human skimming product intent** — reads only the prose sections at the top.
2. **An implementer (human or a less capable execution model like Sonnet)** — expands
   the *Guided Walkthrough* for a dense, step-by-step walkthrough.
3. **Machines** — read the structured YAML in the *LLM Context* block.

The skill writes the prose directly. `src/tasks/body-sections/body-sections.ts`
reads it back, splitting the body into its named sections and the Acceptance
Criteria checklist for `ticket get --section`. The YAML round-trips separately
through `BodyMetadataService.parse` / `splice` (see
`src/tasks/body-metadata/body-metadata.ts`).

A ticket whose Jira issue type is `Bug` uses
[the bug report format](./bug-report-format.md) instead, with the same
three-reader shape.

## Template

Emit the sections in this exact order. Headings and the two `<details>` summaries
are verbatim.

```markdown
## Problem Statement

<One paragraph. The grounding — everything below ties back to this.>

## Solution

<Human-readable description of what will be built.>

## Acceptance Criteria

- [ ] <Independently verifiable condition.>
- [ ] <Another.>

## High-level technical writeup

<What's being built, at the altitude-appropriate depth.>

<details><summary>Guided Walkthrough</summary>

<Dense implementer walkthrough as PLAIN MARKDOWN — code fences, lists, links all
render. This section is only present on tickets, and may be reduced to hints for
a sharpen-the-saw ticket (the tests carry the spec).>

</details>

<details>
<summary>LLM Context</summary>
<!-- flight-rules:metadata -->

```yaml
size: ticket
# ...other EntityMetadata fields spliced by BodyMetadataService
```

</details>
```

## Supported markdown

`LayeredBodyAdfConverter.toAdf` parses with `mdast-util-from-markdown` plus the
GFM extensions and maps a fixed subset of nodes to ADF. The read direction
(`toMarkdown`) is a hand-written emitter, so `*`/`_` are never over-escaped and
canonical markdown round-trips byte-stably.

Mapped constructs:

- **Headings** (`#`–`######`) → `heading` with `attrs.level`.
- **Paragraphs** → `paragraph`; a soft line break becomes a `hardBreak` so single
  newlines survive the round-trip.
- **Inline marks**, which accumulate through nesting onto one text node:

  | Markdown | ADF mark |
  | --- | --- |
  | `*x*` / `_x_` | `em` |
  | `**x**` | `strong` |
  | `~~x~~` | `strike` |
  | `` `x` `` | `code` |
  | `[label](href)` / `[label](href "title")` | `link` with `attrs.href` and optional `attrs.title` |

  So `***x***` carries `em` + `strong`, and `[**x**](u)` carries `strong` + `link`.
  ADF's `code` mark drops any inherited `em`/`strong`/`strike` (but keeps a link),
  so `` **`x`** `` normalizes to `` `x` ``.
- **Fenced code** → `codeBlock`, carrying the language in `attrs.language`.
- **Bullet, ordered, and nested lists** → `bulletList` / `orderedList`; a
  `listItem` holds `[paragraph, nested list]` at any depth, and a bullet may nest
  inside an ordered list or the reverse. **Task lists** (`- [ ]` / `- [x]`) →
  `taskList` with `TODO`/`DONE` task items (top level only — task items hold
  inline content, not nested lists).
- **Thematic breaks** (`---`) → `rule`.
- **`<details>`/`<summary>` pairs** → `expand`, the summary as `attrs.title`;
  nested details nest.
- **GFM tables** → `table` of `tableRow`s; the first row's cells are
  `tableHeader`, the rest `tableCell`, and every cell holds one `paragraph`.
- **Blockquotes** → `blockquote`, holding paragraphs, lists, and code blocks.
- **GitHub admonitions** — a blockquote whose first line is a `[!TYPE]` marker →
  `panel`, by this map:

  | Markdown | ADF `panelType` |
  | --- | --- |
  | `> [!NOTE]` | `info` |
  | `> [!TIP]` | `success` |
  | `> [!IMPORTANT]` | `note` |
  | `> [!WARNING]` | `warning` |
  | `> [!CAUTION]` | `error` |

  `IMPORTANT` shares the `note` panel with no dedicated Atlassian equivalent.

Degradation and normalizations:

- **Literal-text degradation.** Images and stray HTML are kept as literal text
  sliced from their markdown source, so they round-trip byte-identically until
  their own node-family ticket claims them. An unclosed `<details>` degrades to
  literal paragraph text rather than looping.
- **Demotions on tables, quotes, and panels.** ADF's content models are narrower
  than GFM's, so some detail is a documented one-way loss:
  - **Column alignment is lost.** ADF paragraphs inside cells carry no alignment,
    so `| :--- | ---: |` normalizes to `| --- | --- |`.
  - **Headings and nested quotes stay literal inside a blockquote.** A `blockquote`
    admits only paragraphs, lists, and code blocks, so `> ## Title` and a nested
    `> >` re-emit verbatim as literal quoted text rather than structured nodes.
  - **A code fence forces the blockquote fallback for alerts.** A `panel` cannot
    hold a code block, so an admonition containing one degrades to a plain
    `blockquote` that keeps its `[!TYPE]` marker as literal first-paragraph text.
  - **Tables do not render on Jira mobile**, which shows their ADF as bare text.
- **Mark normalizations.** `_x_` → `*x*`; a link whose text equals its href
  collapses to the bare url; `` **`x`** `` drops the bold from the code span;
  `underline`, `textColor`, `subsup`, and `border` marks emit their text
  unmarked. Marks reapply in their stored nesting order, so `[**x**](u)` keeps the
  link outside the bold and `**[x](u)**` keeps it inside.
- **List normalizations.** `*` and `+` bullets render as `-`; nested indentation
  is the parent marker width (`- ` = 2, `1. ` = 3, `10. ` = 4), so four-space
  nesting collapses; a paragraph joins a nested list with a single newline and
  another block with a blank line.
- **Loose lists.** A list with blank lines between its items (a *loose* list) has
  no ADF equivalent, so it emits as one single-item list per item; the emitter's
  `\n\n` block join reproduces the blank lines.
- **Ordered-list renumbering.** `orderedList` markers are rendered from the list
  start (`attrs.order`, defaulting to 1), not from the source digits, so
  `1. a\n1. b` renumbers to `1. a\n2. b`.

## Rules

- **The Guided Walkthrough is a separate `<details>` block, not inside the YAML.**
  A nested ` ``` ` code fence in the walkthrough would prematurely close the outer
  ` ```yaml ` fence in the LLM Context block. Keep them apart.
- **Only the LLM Context YAML is managed by `BodyMetadataService`.** It keys off the
  `<!-- flight-rules:metadata -->` sentinel and rewrites only the fenced YAML inside
  that block; everything above (all prose, the Guided Walkthrough) is left
  byte-identical on `splice`.
- **`size`** is a typed field on `EntityMetadataSchema`
  (`'ticket' | 'epic' | 'initiative'`). Set it to the node's altitude.
- **Acceptance Criteria are `- [ ]` checkboxes** — verifiable by a human or a bot,
  on epics *and* tickets.
- **A `Bug` ticket uses [the bug report format](./bug-report-format.md) instead of
  this one**, selected by the Jira issue type.
