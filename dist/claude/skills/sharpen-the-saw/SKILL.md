---
name: sharpen-the-saw
description: "Hand-run companion for a sharpen-the-saw ticket. Reads the labeled ticket, creates a branch, and writes a complete, runnable, all-red test suite pinning the ticket's contract — then STOPS so a human implements to green. Keeps foundational engineering skills warm by handing real work to people via agentically-aided TDD. Use when an engineer starts a ticket labeled sharpen-the-saw."
---

# Sharpen the Saw

This is a **hand-run** skill. An engineer invokes it when they pick up a ticket labeled `sharpen-the-saw`. It does the setup — reads the ticket, cuts a branch, and writes a failing test suite that pins the contract — and then **stops**. The human writes the implementation to green.

The point is deliberate: if agents build everything, senior engineers' foundational skills atrophy. Sharpen-the-Saw keeps a trickle of real, worthwhile work in human hands, practiced the honest way — TDD against a fixed spec. The tests carry the spec; the human does the thinking.

**The hard rule: this skill never writes the implementation.** It pins the contract and stops. Contract fixed, solution open. If you catch yourself about to implement, stop — that defeats the entire exercise.

## Preconditions

- You are handed a **ticket id**.
- Run everything from the **repo root** (the `flight-rules` CLI resolves config relative to CWD).

## Process

You MUST create a todo per step and complete them in order.

### 1. Read the ticket

```bash
flight-rules ticket get <id>
```

From the returned body, extract:
- The **Acceptance Criteria** (the checklist) — this is the contract you will pin.
- The **`sharpen-the-saw` label**, and its competency suffix if present (`sharpen-the-saw:<competency>`) — this shapes the *kind* of tests (e.g. `define-a-schema`, `wire-an-endpoint`, `pure-transform`).
- The interface the ticket names — the function / endpoint / schema / module the human will implement.

**Verify it is actually a saw ticket.** If the `sharpen-the-saw` label is absent, stop and tell the engineer this ticket isn't a saw candidate — it should run through the normal pipeline, not this skill.

### 2. Read the Guided Walkthrough — but do NOT surface it

If the ticket has a `Guided Walkthrough`, read it to shape the tests. **Do not show it to the engineer, and do not paste it into the branch.** For a saw ticket the walkthrough is suppressed to hints only — the human practices the implementation thinking. At most, surface a one-line hint if they're truly stuck.

### 3. Create the branch

Use the deterministic CLI command — do not hand-roll `git checkout`:

```bash
flight-rules git checkout --type <semantic-type> --scope <id> --description <slug> [--from <base>]
```

- `--type` — the semantic type matching the work (`feat` for new capability, `fix` for a bug, etc.).
- `--scope` — the ticket id.
- `--description` — a short kebab slug from the ticket title.
- `--from <base>` — pass this **only** when the work stacks on another in-flight branch; otherwise omit and it branches off current HEAD.

### 4. Write the failing suite

Write a **complete, runnable test suite** that pins the contract from the Acceptance Criteria:

- **Real assertions, not skeletons.** No `todo`/`skip` stubs. Every test is a concrete `input → expected output` check. If the human ends up writing tests, the exercise has failed.
- **Black-box against the named interface.** Test the public contract the ticket specifies — not a particular implementation shape. Pin *what*, leave *how* to the human.
- **Follow the repository's existing test conventions** — framework, file placement, and style. (Detect from the repo; e.g. this project uses vitest with colocated `<name>.test.ts` files.)
- **Cover the acceptance criteria.** Each checkable condition should map to at least one test. Include the obvious edge cases the competency implies (validation rejects bad input, empty/boundary cases, etc.).

### 5. Confirm it's red for the right reason

Run the suite. Every new test must **fail because the implementation doesn't exist yet** — not because a test is malformed. If something fails for the wrong reason (typo, bad import), fix the test, not by implementing.

```bash
<repo test command, e.g. npm test -- <path>>
```

### 6. Hand off and stop

Report to the engineer:
- The branch name.
- The test files written and how to run them.
- One sentence: *"Implement against these tests until they pass. Done = the suite is green — the same bar an agent would be held to."*

Then **stop.** Do not implement. Do not open a PR. The human takes it from here.

## What Good Looks Like

- The engineer lands on a branch with a red suite and no solution in sight.
- Every acceptance criterion is pinned by a real, failing test.
- The Guided Walkthrough was never surfaced.
- "Done" is unambiguous and self-checking: the suite goes green.
- If the label were stripped, nothing here would be needed — the pipeline would swallow the ticket like any other. This skill is the human's on-ramp, not a required gate.
