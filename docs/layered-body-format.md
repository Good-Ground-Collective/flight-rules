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
the round-trip stays byte-stable.

Mapped constructs:

- **Headings** (`#`–`######`) → `heading` with `attrs.level`.
- **Paragraphs** → `paragraph`; a soft line break becomes a `hardBreak` so single
  newlines survive the round-trip.
- **Inline marks**: bold (`**x**`) → `strong`, inline code (`` `x` ``) → `code`,
  and links (`[label](href)`) → a `link` mark on the label text.
- **Fenced code** → `codeBlock`, carrying the language in `attrs.language`.
- **Bullet lists** → `bulletList`; **task lists** (`- [ ]` / `- [x]`) → `taskList`
  with `TODO`/`DONE` task items; **ordered lists** → `orderedList`.
- **Thematic breaks** (`---`) → `rule`.
- **`<details>`/`<summary>` pairs** → `expand`, the summary as `attrs.title`;
  nested details nest.

Degradation and normalizations:

- **Literal-text degradation.** Any construct outside the subset — emphasis,
  strikethrough, images, tables, blockquotes, stray HTML — is kept as literal
  text sliced from its markdown source, so it round-trips byte-identically until
  its own node-family ticket claims it. An unclosed `<details>` degrades to
  literal paragraph text rather than looping.
- **Loose lists.** A list with blank lines between its items (a *loose* list) has
  no ADF equivalent, so it emits as one single-item list per item; the emitter's
  `\n\n` block join reproduces the blank lines.
- **Ordered-list renumbering.** `orderedList` markers are rendered from the list
  start (`attrs.order`, defaulting to 1), not from the source digits.

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
