# Anthropogenic Spec Writing Skill — Design Spec

**Date:** 2026-06-21
**Status:** Approved
**Builds on:** [`2026-05-27-flight-rules-plugin-design.md`](2026-05-27-flight-rules-plugin-design.md)

---

## Problem Statement

Our PDE department has started delegating judgment to AI agents, letting them build the solution front to back, rather than utilizing agents to execute on their own taste and intuition in an expedited fashion; as a replacement, not a boost.

---

## Solution

A guided skill that forces a human to author an RFC before any agent touches a codebase. It either accepts a reference to an existing spec file or builds one interactively through Socratic questioning — no canned options, free-form responses only. The output is an RFC markdown document committed to git and opened as a PR for human review. Reviewers are embedded in the document frontmatter and tagged in the platform (GitHub review request, Atlassian mention). RFCs are stored either locally in the project or in a dedicated global RFC repository depending on team configuration. Minimum viable spec: Problem Statement + Solution + metadata. User input is saved verbatim by default; the skill only prompts for additional help when input reads as rough or stream-of-consciousness.

---

## Background

Agentic workflows inside the team produced large context directories — planning docs, architecture maps, design guides — built because humans were not explaining the work clearly upfront. This happened for one of three reasons: they didn't understand the codebase initially, they couldn't articulate it clearly, or they had become completely disconnected from what was being built as agents took the wheel. The result was codebases that no longer read as engineer-built — hard to understand at first pass, not something a new team member could navigate without the knowledge bank.

This skill explicitly avoids creating or consuming an agentic knowledge bank. The context comes from the human's own words, captured once at the start of the work. The goal is a codebase that humans and agents can work in equally well — produced by a team that sweated the details rather than rubber-stamped outputs from a caffeine-fueled bender.

This philosophy runs deeper than just process. The reason we prefer service classes over loose functions, for instance, is that the structure forces context to live inline — `MachineReadableMetadataService.parse()` communicates intent at a glance in a way that `parseMachineMetadata()` does not. The same principle applies here: human-authored specs force the author to articulate intent in their own words, keeping engineers and PMs close to the work rather than acting as approvers of agent output.

---

## RFC Document Format

Every RFC produced by this skill shares a consistent structure.

### Frontmatter

```yaml
---
id: RFC-001
title: ...
date: 2026-06-21
author: github_username
status: draft | proposed | accepted
reviewers:
  - github_user_1
  - github_user_2
repos:
  - org/repo-name
---
```

- `id` is auto-incremented by scanning existing RFC files in the storage location.
- `status` begins as `draft`, moves to `proposed` when the PR opens, and to `accepted` when merged.
- `reviewers` maps to platform-appropriate reviewer actions on PR open (see Technical Notes).
- `repos` declares which repositories the work will touch — used for downstream agent context.

### Sections

| Section | Required | Purpose |
|---|---|---|
| Problem Statement | Yes | Single sentence. The grounding source for all other content. |
| Solution | Yes | What we will build. Condensed goal posts. |
| Background | No | Why we're doing it in greater depth. |
| Technical Notes | No | Design diagrams, schemas, architectural nudges. |
| Known Gaps and Edge Cases | No | Things that could send this sideways; explicit out-of-scope calls. |

The template file lives at `ideal-format.md` in the flight-rules repository root and is the canonical reference for section descriptions and examples.

---

## Technical Notes

### Storage Modes

Configured in `.claude/flight-rules.local.md`:

```yaml
rfcStorage: local       # creates rfcs/ directory in the current project
# or
rfcStorage: global
rfcStoragePath: /path/to/rfc-repository
```

- **Local**: RFCs land in `rfcs/` at the root of the current project repository.
- **Global**: RFCs land in a dedicated repository whose path the team configures once. All projects share the same RFC store.

### Auto-Increment

The skill scans existing RFC files in the configured storage location, finds the highest existing `RFC-NNN` ID, and increments by one. Padded to three digits minimum (`RFC-001`, `RFC-002`, ...).

### Reviewer Tagging

Platform-appropriate tagging is applied automatically when the RFC PR is opened:

| Platform | Mechanism |
|---|---|
| GitHub | PR review request for each listed reviewer |
| Atlassian | @ mention in the PR/ticket description |

### CLI Addition: `flight-rules users get`

A new CLI command that fetches org members from the configured platform, returning a list of user handles for reviewer selection during the interactive flow. Implementation details deferred to the plan.

### Section Saving Behavior

User input is saved **verbatim by default**. The skill does not rewrite, summarize, or replace what the user typed.

The skill prompts for additional help only when the input is clearly rough — significant typos, fragmented sentences, or stream-of-consciousness phrasing. When prompted, the user can choose:

1. **Save as-is** — keep exactly what they typed (always the default)
2. **Add context** — keep their words verbatim as a block, with the skill appending structured context drawn from the conversation
3. **Rewrite** — let the skill produce a cleaned-up version while preserving the user's intent

The goal is to preserve human voice while not penalizing people who think out loud in the chat.

### Interactive Flow

When no spec file is provided:

1. Skill explains what an RFC is and why it matters (brief, not a lecture)
2. Ask for Problem Statement — free-form, no options
3. Push back if the response is vague or symptom-level rather than root-cause
4. Ask for Solution — free-form
5. Push back if solution doesn't clearly connect to the problem
6. Ask for Background (optional — user can skip)
7. Ask for Technical Notes (optional — user can skip)
8. Ask for Known Gaps and Edge Cases (optional — user can skip)
9. Apply section-saving logic (verbatim by default, prompt if rough)
10. Populate frontmatter interactively: title, reviewers (from `users get`), repos
11. Write RFC file, commit, open PR with reviewers tagged

When a spec file is provided:

1. Read the file
2. Interrogate the author on what they've written — check that Problem Statement is root-cause level, Solution connects clearly to it, gaps are surfaced
3. Ask follow-up questions on any section that is thin or vague
4. Confirm frontmatter fields are complete
5. Proceed to commit and PR

---

## Known Gaps and Edge Cases

**In scope, implementation deferred:**
- `flight-rules users get` CLI command — required for reviewer selection; full implementation spec to follow
- Atlassian reviewer tagging — interface is designed for it; Atlassian backend implementation follows the GitHub-first delivery

**Out of scope for V1:**
- Mid-pipeline spec refresh — requires a running pipeline to detect drift; deferred until the full software factory is operational
- Spec quality scoring / grading rubric — a follow-up RFC to be written using this skill as the first real test case

**Ambiguities to resolve during implementation:**
- How rough is "rough enough" to trigger the save prompt — the skill must make a judgment call; erring toward verbatim is correct
- Global RFC repository: the skill needs read/write access; authentication follows the same token pattern as the task tracker

---

## Relationship to the Broader Pipeline

This skill is the **first step** in the software factory. It produces an RFC that all downstream agents — initiative-planner, ticket-planner, system-architect, senior-engineer — consume as their grounding source. No agent should begin planning or implementation work without a merged RFC.

The RFC is intentionally not an agentic artifact. It is a human artifact that agents read. The distinction matters.
