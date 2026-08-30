# Pull Request Body Format

The shape every pull request opened through `flight-rules pr create` must follow.
It serves two readers at once:

1. **A reviewer** who is *not* about to read the diff line by line and wants to
   know, fast, whether this is worth their time to review and merge.
2. **A QA engineer or product manager** who wants to confirm the team actually
   built what was asked.

The skeleton is rendered deterministically by
`src/git/pr-template/pr-template.ts` — headings, the `<details>` wrapper, the
bullet formatting, and the length budget are guaranteed by the schema. The
**content** of the prose sections is authored by the `tech-writer` agent
(author mode), so every PR body reads like a human wrote it and passes the same
prose charter that `review-prose` enforces.

## Template

Sections render in this exact order. The first two are always present; the last
two appear only when their fields are supplied.

```markdown
## What Was Changed

- <A change, one or two sentences, at most 256 characters.>
- <Another. No more than five bullets total — two or three is the target.>

## Why Was It Changed

<A short, human-centric explanation grounded in the ticket. Speaks in product
terms even for a technical PR. Uses paragraphs and, where they help, bullets —
never a wall of text. This is the case for why the work is worth reviewing and
merging.>

## OTS Materials

<details><summary>Click to expand</summary>

<Screenshots or a screen recording of the change working, when there is a visual
result to show — always include them for a visual change. For a standalone API,
JSON pulled from the endpoint. Enough to verify the work, not a data dump.>

</details>

## Ticket Link

- [<TICKET-ID>](<ticket url>)
```

## Field rules

- **`whatWasChanged`** — 1 to 5 bullets, each at most 256 characters. The schema
  rejects anything outside that budget; the agent aims for two or three.
- **`whyWasItChanged`** — required prose. Grounded in the ticket's Problem
  Statement and Solution, phrased for a human deciding whether to spend time on
  this PR.
- **`otsMaterials`** — optional. A raw markdown/JSON blob the CLI wraps in the
  `<details>` block verbatim. Image *hosting* is the caller's job: pass already-
  hosted image markdown, or text/JSON that needs no hosting. The renderer does
  not upload anything.
- **`ticketId` / `ticketUrl`** — when both are present the section renders a
  markdown link; with only an id it renders the bare id; with neither the whole
  section is omitted.

## Rules

- **The renderer owns the skeleton; the agent owns the words.** Never hand-write
  a PR body and pass it as one blob — route the authored fields through
  `pr create` so the structure and length budget stay enforced.
- **OTS Materials is passthrough.** The CLI never fetches, uploads, or renders an
  image; it wraps whatever string it is handed. What goes in is an upstream
  decision (see `skills/execute-work/SKILL.md`).
- **The body is byte-deterministic.** The same template always renders the same
  body, so a re-run of `pr create` after a config fix produces an identical PR.
