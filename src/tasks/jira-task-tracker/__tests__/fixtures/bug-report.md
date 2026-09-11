## Symptom

The ticket description renders as raw markdown asterisks and pipes in the Jira UI instead of formatted content.

## Environment

Staging (`flight-rules` 1.46.0), auditor role, Chromium 140, observed 2026-09-10.

## Steps To Reproduce

1. Open a ticket created by `break-down-work`.
2. Read the description panel in the Jira UI.

> [!CAUTION]
> **Trap for QA:** the REST payload looks correct, so only the rendered panel shows the bug.

## Expected vs Actual

**Expected:** the description renders headings, lists, and tables.

**Actual:** the description shows literal markdown source.

## Root Cause

The create path posted the markdown string straight into the description field.

## Fixed When

- [ ] A created ticket's description renders as formatted ADF in Jira.
- [ ] `ticket get` still returns the original markdown.

## Evidence

![Before](./before.png)

![After](./after.png)

<details><summary>Reproduction Notes</summary>

Create a ticket with `ticket create --body-file body.md`, then GET the issue and inspect `fields.description`.

</details>

<details>
<summary>LLM Context</summary>
<!-- flight-rules:metadata -->

```yaml
epicId: 12
kind: bug
notes: fixture
```

</details>
