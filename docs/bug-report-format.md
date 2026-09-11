# Bug Report Format

The body shape every Jira `Bug` ticket follows. It is a sibling of the
[layered body format](./layered-body-format.md): human-readable prose at the top,
agent-facing detail in collapsed `<details>` blocks beneath, and one machine-read
YAML block at the bottom. The reporter states the symptom, `reproduce-bug` fills
in the diagnosis, `execute-work` builds against it, and `verify-ticket` confirms
the fix, all from the same document.

## Three readers, one document

1. **A human triaging the bug** — reads the prose sections from *Symptom* through
   *Evidence*, and looks at the before/after images.
2. **`reproduce-bug` and `execute-work`** — expand *Reproduction Notes* for the API
   calls that carry the symptom, the selectors, and the data setup.
3. **Machines** — read the structured YAML in the *LLM Context* block, which
   round-trips through `BodyMetadataService.parse` / `splice` (see
   `src/tasks/body-metadata/body-metadata.ts`).

The section reader is `src/tasks/body-sections/body-sections.ts`. It matches
level-2 heading text byte for byte, so the heading strings below are the contract:
change one and its section stops parsing.

## Skeleton

Emit the sections in this exact order. Headings and the two `<details>` summaries
are verbatim. The outer fence is four backticks because the skeleton carries a
three-backtick `yaml` fence of its own.

````markdown
## Symptom

<One paragraph. What the user sees. The grounding; everything below ties back to this.>

## Environment

<Host, build or version, account or role, browser, date observed.>

## Steps To Reproduce

1. <Human-followable step.>
2. <Another.>

> [!CAUTION]
> **Trap for QA:** <why it can look fine but isn't. Optional.>

## Expected vs Actual

**Expected:** <…>
**Actual:** <…>

## Root Cause

<One line or a short list. Filled in by reproduce-bug.>

## Fixed When

- [ ] <Independently verifiable condition. execute-work and verify-ticket read this.>

## Evidence

![Before](./before.png)
![After](./after.png)

<details><summary>Reproduction Notes</summary>

<Agent-facing. The API calls that carry the symptom, selectors, data setup,
the reversible-mutation recipe. Plain markdown.>

</details>

<details>
<summary>LLM Context</summary>
<!-- flight-rules:metadata -->

```yaml
# EntityMetadata fields spliced by BodyMetadataService
```

</details>
````

## Sections and slugs

Each section has a `ticket get --section <slug>` slug, a writer, and a place in the
lifecycle. The slug is the heading in kebab-case.

| Heading | `--section` slug | Writer | Notes |
| --- | --- | --- | --- |
| Symptom | `symptom` | reporter | The grounding paragraph. |
| Environment | `environment` | reporter | Where and when the bug was seen. |
| Steps To Reproduce | `steps-to-reproduce` | reporter | Human-followable; carries the optional Trap for QA. |
| Expected vs Actual | `expected-vs-actual` | reporter | The gap, stated plainly. |
| Root Cause | `root-cause` | `reproduce-bug` | One line or a short list. |
| Fixed When | `fixed-when` | `reproduce-bug` | Returns `items[]` from its `- [ ]` checklist. |
| Evidence | `evidence` | `reproduce-bug` | Before/after images, attached natively in Jira. |
| Reproduction Notes | `reproduction-notes` | `reproduce-bug` | Matched by its `<summary>` text, case-insensitive, like Guided Walkthrough. |

The reporter writes Symptom, Environment, Steps To Reproduce, and Expected vs
Actual. `reproduce-bug` fills Root Cause, Fixed When, Evidence, and Reproduction
Notes. `verify-ticket` and `execute-work` read Fixed When to know when they are
done, and do not edit it.

## Rules

- **`## Fixed When` uses the `- [ ]` checklist grammar.** The reader parses each
  item into `items[]`, marking `done` true for `- [x]`, exactly as it does for
  Acceptance Criteria. `verify-ticket` and `execute-work` walk that array.
- **Reproduction Notes is a separate `<details>` block.** It sits below Evidence
  and never goes inside the YAML fence. A nested code fence in the notes would
  close the `yaml` fence early and corrupt the metadata.
- **The Trap for QA renders as a Jira panel.** The `> [!CAUTION]` admonition under
  Steps To Reproduce maps to an Atlassian Document Format (ADF) panel, so the
warning survives the trip from
  markdown to Jira instead of flattening to a quote.
- **The format is identified by issue type, then `metadata.kind`, then the
  heading.** A Jira issue type of `Bug` selects this format first. An explicit
  `metadata.kind` in the LLM Context YAML overrides it. A leading `## Symptom`
  heading is the last fallback.
- **Only the sentinel-keyed YAML is managed by `BodyMetadataService`.** It keys off
  the `<!-- flight-rules:metadata -->` sentinel and rewrites only the fenced YAML
  beneath it; everything above, all prose and both `<details>` blocks, is left
  byte-identical on `splice`.
