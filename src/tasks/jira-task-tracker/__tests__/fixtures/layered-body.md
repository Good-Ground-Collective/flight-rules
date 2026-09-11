## Problem Statement

Users see raw markdown in the Jira UI instead of *formatted* content, so a ticket body reads as noise.

## Solution

Convert **markdown** to ADF on write and back on read, keeping the [layered body format](https://example.com/layered-body) intact. The subset stays small:

- headings and prose with marks
- task lists and nested lists
- tables, blockquotes, and admonitions

## Acceptance Criteria

- [ ] Formatted content renders in Jira
- [x] `ticket get` still returns markdown

## High-level technical writeup

Convert on the boundary and degrade anything outside the subset to literal text.

| Direction | Entry point |
| --- | --- |
| write | `toAdf` |
| read | `toMarkdown` |

> [!NOTE]
> The converter degrades anything outside the subset to literal text.

Ownership stays out of the converter; @{5b10|Ada Lovelace} resolves identity.

<details><summary>Guided Walkthrough</summary>

Start with the converter:

```ts
markdownAdfConverter.toAdf(body)
```

- keep the subset small
  - degrade gracefully

</details>

<details>
<summary>LLM Context</summary>
<!-- flight-rules:metadata -->

```yaml
epicId: 12
notes: fixture
```

</details>
