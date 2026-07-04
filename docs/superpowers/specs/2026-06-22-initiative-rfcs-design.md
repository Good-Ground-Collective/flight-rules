# [REJECTED] Initiative RFCs + Epic↔Initiative Linking — Design Spec

**Date:** 2026-06-22
**Status:** REJECTED

> **Rejected 2026-07-04.** Superseded by a new direction that prioritizes minimal friction to get started. This document is retained for historical context.
**Builds on:** [`2026-06-21-anthropogenic-spec-skill-design.md`](2026-06-21-anthropogenic-spec-skill-design.md)

---

## Problem Statement

The `draft-spec` skill produces a single altitude of RFC — the epic — but real work spans altitudes, and there is no way to frame a strategic theme (a collection of epics) or to recognize when a request a user brought in as "a spec" is actually too big and should be framed as an initiative first.

---

## Solution

Extend the RFC framing to three altitudes — **Initiative → Epic → Story** — keeping the exact same five-section shape at every level. Concretely, for V1:

- Add a `draft-initiative` skill that produces an **initiative RFC** (`INIT-NNN`) and then offers to decompose it into epics.
- Keep `draft-spec` as the **epic RFC** entry point (`RFC-NNN`, unchanged), adding one beat: an optional link to a parent initiative.
- Extract the shared five-section Socratic flow into `_shared/rfc-engine.md` so both skills coach identically and only diverge on altitude-specific behavior.
- Link children up to parents (`initiative: INIT-NNN` in epic frontmatter); generate the parent's child list on demand via the CLI rather than hand-maintaining it.
- Add **altitude redirection**: each skill recognizes when the work in front of it belongs at a different altitude and routes the user there before proceeding.

Story (`STORY-NNN`) is reserved but not built in V1.

---

## Background

`draft-spec` deliberately forces a human to author an RFC before agents touch a codebase, and the team liked that framing enough to want it at every planning altitude — not just the epic. The pipeline design already named the altitudes implicitly (`initiative-planner`, `ticket-planner`) and `ideal-format.md` already states the five-section format is "for an epic, can be adjusted to fit an initiative and a story." This spec makes that explicit and builds the rung above the epic.

The driving use case the team raised: a user arrives asking for "a spec," but what they're describing is several independent deliverables across repos — an initiative. The tooling should catch that and say *"this sounds more like an initiative; let's frame that first, then do a round for the epics,"* rather than silently letting a too-big problem statement through. That redirection — in both directions — is the connective tissue between the two skills.

---

## Hierarchy & Vocabulary

"RFC" is the **genre** — a human-authored, reviewed spec document. **Initiative**, **Epic**, and **Story** are **altitudes** within that genre.

```
Initiative   (INIT-NNN)   strategic "why"; a collection of epics
   └─ Epic   (RFC-NNN)    a deliverable chunk — draft-spec today
        └─ Story (STORY-NNN, reserved, not built in V1)
```

The five-section shape is identical at every altitude. Initiatives are kept **strictly fractal** — no strategic-only fields (no "success metrics" section, no "epic sequencing" section). If sequencing or metrics matter, they live in the initiative's prose Solution. This is a deliberate YAGNI call: the uniform shape is the value, and extra fields can be a follow-up RFC if a real need surfaces.

---

## Skills & Shared Engine

```
skills/
  draft-spec/SKILL.md         # epic entry (unchanged), + optional parent link
  draft-initiative/SKILL.md   # initiative entry + decomposition
  _shared/rfc-engine.md       # five-section flow, verbatim-save rules,
                              # frontmatter collection, commit + PR open
```

Both `SKILL.md` files instruct the agent to read `_shared/rfc-engine.md`, so the five-section Socratic flow, verbatim-save behavior, frontmatter collection, and commit/PR logic live exactly once. The exact plugin-packaging mechanism for the shared file (relative path resolution within the plugin cache) is an implementation detail for the plan.

What differs per skill:

| Concern | `draft-spec` (epic) | `draft-initiative` |
|---|---|---|
| Altitude-tuned pushback | Problem Statement is a deliverable-scoped pain | Problem Statement is a strategic theme |
| Linking | Asks "does this belong to an initiative?" → optional parent link | Offers decomposition into child epics |
| Redirection | Points **up** when scope reads strategic | Points **down** when a named epic is really a story; **up** when it's really another initiative |

---

## Altitude Redirection

The same check at both skills, parametrized per altitude: *am I at the right altitude, and what are the smells that I'm too high or too low?* The rubric lives in `_shared/rfc-engine.md`.

**Pointing up, in `draft-spec` (epic):** during the Problem Statement / Solution beats, if the scope reads strategic — several independent deliverables, spans multiple repos or teams, no single shippable outcome — the skill stops and says: *"This sounds more like an initiative than a single epic. Let's frame the initiative first, then come back and decompose it into epics."* It then hands off to `draft-initiative`.

**Pointing down, in `draft-initiative` decomposition:** when the user names candidate epics, push back on altitude mismatches:
- Too small (one ticket's worth of work, no meaningful decomposition) → that's a story; fold it into a sibling epic.
- Too big (its own multi-epic theme) → that's its own initiative; split it out.

Redirection is coaching, not a hard gate — the user can override, but the skill must surface the mismatch.

---

## Linking Model

- **Child points up.** Epic frontmatter carries `initiative: INIT-NNN`.
- **Parent never hand-lists children.** `flight-rules rfc rollup INIT-NNN` scans epic files for matching `initiative:` values and generates the list on demand. This mirrors the existing scan-don't-track approach used by ID auto-increment, so the rollup never goes stale.

```yaml
# Initiative RFC
id: INIT-001
title: ...

# Epic RFC
id: RFC-014
title: ...
initiative: INIT-001    # the link
```

---

## Decomposition Flow (blessed top-down path)

In `draft-initiative`, after the initiative RFC sections are solid and the file is written + committed:

1. "An initiative is a collection of epics — let's name them." Socratic, one-line deliverable per epic.
2. Apply altitude redirection (pointing down) to each named epic.
3. Per confirmed epic, offer:
   - **Draft now** — run the shared epic engine with `initiative:` pre-filled.
   - **Stub** — write a minimal epic RFC (title + Problem Statement + `initiative:` link + `status: draft`) to be fleshed out later by `draft-spec`.

Each epic is its own file, ID, commit, and PR. Stubbing keeps sessions bounded — the user does not have to fully spec every epic in one sitting. The initiative RFC PR and the epic PRs are independent; epics reference `INIT-NNN` as soon as the initiative file exists, regardless of its PR/merge state.

---

## CLI Additions

| Command | Purpose |
|---|---|
| `flight-rules rfc next-id --level initiative` | Returns the next `INIT-NNN`. Epics keep the existing default (`RFC-NNN`). |
| `flight-rules rfc rollup INIT-NNN` | Scans epic files and lists children linked to the initiative. |

`flight-rules rfc dir` and `flight-rules users get` are reused unchanged. Initiative and epic RFCs share the same storage location (local or global per `flight-rules.local.md`).

---

## Bottom-Up Attach

`draft-spec` gains one beat: "Does this belong to an initiative?" If yes, it scans existing initiatives (via the storage location) and stamps `initiative: INIT-NNN` onto the epic frontmatter. This covers epics that predate their initiative without making top-down the only path.

---

## Known Gaps and Edge Cases

**Out of scope for V1:**
- Story / Spec altitude (the third rung) and `STORY-NNN` IDs — reserved, not built.
- Status roll-up — deriving an initiative's status from its epics' statuses.
- Atlassian-specific reviewer nuance beyond what `draft-spec` already does.

**Ambiguities to resolve during implementation:**
- The exact altitude-smell rubric — what concretely counts as "too big for an epic" vs. "too small for an initiative." Erring toward surfacing the mismatch and letting the human decide is correct.
- Plugin-packaging path resolution for the shared `_shared/rfc-engine.md` reference.
- Whether decomposition stubs open PRs immediately or stay as local drafts until fleshed out — likely a per-epic choice, deferred to the plan.

---

## Relationship to the Broader Pipeline

This builds the rung directly above the epic in the software factory. The initiative RFC becomes the topmost human-authored grounding document; epics inherit its strategic context via the `initiative:` link, and downstream agents can walk from any epic up to the initiative that justifies it. As with the epic RFC, the initiative RFC is a human artifact that agents read — not an agent artifact that humans rubber-stamp.
