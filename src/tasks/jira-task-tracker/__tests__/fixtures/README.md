# Converter golden fixtures

Whole-document goldens for the markdown ⇄ ADF converter
(`src/tasks/jira-task-tracker/markdown-adf.ts`). The inline `it.each` table in
`markdown-adf.test.ts` pins each construct in isolation; these goldens pin the two
real body shapes — the [layered body](../../../../../docs/layered-body-format.md)
and the [bug report](../../../../../docs/bug-report-format.md) — so shape drift
across the parallel converter PRs is caught as a reviewable golden diff.

## Files

- `layered-body.md`, `bug-report.md` — complete bodies: prose sections, the
  collapsed Guided Walkthrough or Reproduction Notes block, and the byte-exact LLM
  Context block.
- `layered-body.adf.json`, `bug-report.adf.json` — the expected ADF for each,
  produced by `toAdf` and treated as the source of truth for the converter's
  output. They are generated, not hand-edited.

## What the golden test proves

`golden.test.ts` asserts three things per fixture:

1. **`toAdf(fixture)` equals the golden.** The emitted ADF is the golden byte for
   byte.
2. **The golden round-trips to the body.** `toMarkdown` of the golden, with the
   metadata expand stripped exactly as `JiraTaskTracker.extractBody` does, equals
   the fixture up to the LLM Context block, byte for byte.
3. **The round trip preserves metadata.** `BodyMetadataService.parse` reads the
   same metadata from the re-emitted body (with the LLM Context block re-attached)
   as from the original fixture.

The LLM Context block is split off for the round-trip leg because the expand
emitter writes the single-line `<details><summary>` form and moves the sentinel
comment, so the canonical multi-line block does not survive `toAdf` → `toMarkdown`
byte for byte. The read path strips that expand before `toMarkdown` anyway, so the
body re-emits exactly and the block's integrity is proven by the metadata parse.

Every golden and every round-trip-table entry is also run through the
`@atlaskit/adf-utils` validator and an `assertContentModel` tree walk
(`../content-model.ts`), so an emitted shape that Jira would reject fails a test.

## Regenerating the goldens

Run the golden test with `UPDATE_GOLDEN=1`; it rewrites the `.adf.json` files from
the current converter output and skips the comparison:

```sh
UPDATE_GOLDEN=1 npx vitest run src/tasks/jira-task-tracker/__tests__/golden.test.ts
```

A ticket that changes the ADF shape a construct emits regenerates the goldens and
**reviews the resulting `.adf.json` diff as part of its own PR** — the diff is the
record of what changed in the converter's output.
