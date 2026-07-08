# Layered Body Format

The body shape every decomposed node (epic, ticket) emitted by `break-down-work`
must follow. It serves three readers from one document:

1. **A human skimming product intent** — reads only the prose sections at the top.
2. **An implementer (human or a "dumber" execution model like Sonnet)** — expands
   the *Guided Walkthrough* for a dense, step-by-step walkthrough.
3. **Machines** — read the structured YAML in the *LLM Context* block.

The prose is written directly by the skill — there is **no** prose serializer or
parser. Only the YAML is structured, and it round-trips through
`BodyMetadataService.parse` / `splice` (see `src/tasks/body-metadata/body-metadata.ts`).

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

## Rules

- **The Guided Walkthrough is a separate `<details>` block, NOT inside the YAML.**
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
