# flight-rules Claude Code Plugin — Design Spec

**Date:** 2026-05-27
**Status:** Approved

---

## Overview

`flight-rules` is a Claude Code plugin that implements a PM-to-engineering pipeline for Good Ground Collective and its collaborators. It provides two orchestration skills, four role-based agents, and a deterministic CLI binary that performs all side-effecting operations against task tracking systems. The LLM reasons; the CLI acts.

The plugin is distributed as a private GitHub repository. Collaborators install it via Claude Code's plugin system using a GitHub token with repo access.

---

## Section 1: Repository Structure

The repository root is the plugin root — no `plugin/` wrapper. Source code and plugin files coexist at the top level.

```
flight-rules/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .claude/
│   └── flight-rules.local.md   # Per-project config (gitignored, set at runtime)
├── .github/
│   └── workflows/
│       └── ci.yml               # Typecheck + build freshness check
├── .config/
│   ├── eslint.config.js
│   └── .oxfmtrc.json
├── skills/
│   ├── initiative-planner/
│   │   └── SKILL.md
│   └── ticket-planner/
│       └── SKILL.md
├── agents/
│   ├── system-architect.md
│   ├── senior-engineer.md
│   ├── product-engineer.md
│   └── code-reviewer.md
├── bin/
│   └── flight-rules             # Pre-built esbuild bundle (committed to git)
├── src/
│   ├── commands/
│   │   ├── epic.ts
│   │   ├── ticket.ts
│   │   └── tdd.ts
│   ├── task-tracker/
│   │   ├── types.ts             # Zod schemas + TaskTracker interface
│   │   ├── github/
│   │   │   └── github-tracker.ts
│   │   └── jira/
│   │       └── jira-tracker.ts
│   ├── source-control/
│   │   └── github/
│   │       └── code-reviewer-formatter.ts
│   ├── config.ts                # Reads .claude/flight-rules.local.md
│   └── index.ts                 # CLI entrypoint, routes subcommands
├── docs/
│   └── superpowers/
│       └── specs/
├── package.json
├── tsconfig.json
└── .nvmrc
```

**Key decisions:**
- `bin/flight-rules` is the compiled esbuild bundle. It is committed to git and referenced as `${CLAUDE_PLUGIN_ROOT}/bin/flight-rules` in all skills and agents.
- `src/` is source-only. Plugin consumers receive it when installing but nothing in the plugin points at it — they interact exclusively with `bin/flight-rules`.
- CI fails any PR where `bin/` is out of sync with `src/`.

---

## Section 2: The PM-to-Engineering Pipeline

The full workflow from brief to implementation:

```
Input (PM brief, markdown file, GitHub Discussion, or Confluence page)
     │
     ▼
[initiative-planner skill]
     ├── dispatches → system-architect agent
     │       Analyzes codebase, proposes solution shape
     ├── dispatches → senior-engineer agent
     │       Refines plan with PM context, breaks into atomic tasks
     └── on approval → CLI creates tracker artifacts
              flight-rules epic create ...
              flight-rules tdd create ... --epic-id <id>
              flight-rules ticket create ... --epic-id <id>  (× N tasks)
                          │
                          ▼ (per ticket)
              [ticket-planner skill]
                   ├── reads codebase for relevant context
                   ├── asks clarifying questions interactively
                   └── on approval → CLI updates ticket body
                        flight-rules ticket create ...

Later, independently:

product-engineer agent  →  implements ticket exactly as specified
code-reviewer agent     →  reviews resulting PR
code-reviewer-formatter →  translates developer replies back to the agent
```

---

## Section 3: CLI Architecture

### Command Structure

```
flight-rules epic   create --title <str> --body <str> [--labels <str,...>]
flight-rules epic   get <id>

flight-rules ticket create --title <str> --body <str> --epic-id <id>
                           [--assignee <str>] [--labels <str,...>]
flight-rules ticket get <id>

flight-rules tdd    create --title <str> --body <str> --epic-id <id>
flight-rules tdd    get <id>
```

The CLI never prompts interactively. All input comes from flags. All output is JSON to stdout. Non-zero exit codes signal failure.

### Configuration

Per-project config lives in `.claude/flight-rules.local.md` with YAML frontmatter. This file is gitignored and set at runtime per project.

```yaml
---
tracker: github
repo: good-ground-collective/some-project
defaultLabels:
  - engineering
---
```

The CLI reads this file on startup and instantiates the correct `TaskTracker` implementation. No `--tracker` flag is needed — the config is the source of truth.

Credentials are read from environment variables:
- `GITHUB_TOKEN` — for the GitHub backend
- `JIRA_TOKEN`, `JIRA_HOST` — for the Jira backend

### `TaskTracker` Interface

```typescript
interface TaskTracker {
  createEpic(input: CreateEpicInput): Promise<Epic>
  getEpic(id: string): Promise<Epic>
  createTicket(input: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign>
  getTechnicalDesign(id: string): Promise<TechnicalDesign>
  addComment(entityId: string, body: string): Promise<Comment>
}
```

Both `GitHubTracker` and `JiraTracker` implement this interface. A future custom tracker needs only to implement this interface to be a valid backend.

### Zod Schemas

```typescript
import { z } from 'zod'

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),  // ISO 8601
  updatedAt: z.string(),  // ISO 8601
})

export const TechnicalDesignSchema = z.object({
  id: z.string(),
  epicId: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  updatedAt: z.string(),
})

export const TicketSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  comments: z.array(CommentSchema),
  assignee: z.string().nullable(),
  updatedAt: z.string(),
})

export const EpicSchema = z.object({
  id: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  childIssues: z.array(TicketSchema),
  comments: z.array(CommentSchema),
  tdd: TechnicalDesignSchema.optional(),
  updatedAt: z.string(),
})

export const CreateEpicInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([]),
})

export const CreateTicketInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().optional(),
})

export const CreateTechnicalDesignInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  epicId: z.string(),
})

export type Comment = z.infer<typeof CommentSchema>
export type TechnicalDesign = z.infer<typeof TechnicalDesignSchema>
export type Ticket = z.infer<typeof TicketSchema>
export type Epic = z.infer<typeof EpicSchema>
export type CreateEpicInput = z.infer<typeof CreateEpicInputSchema>
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>
export type CreateTechnicalDesignInput = z.infer<typeof CreateTechnicalDesignInputSchema>
```

### GitHub Backend Mapping

| Concept | GitHub artifact |
|---|---|
| Epic | GitHub Issue (with sub-issues checklist) |
| TechnicalDesign | GitHub Discussion (category: TDDs) |
| Ticket | GitHub Sub-Issue, linked to Epic |
| Comment | GitHub Issue/Discussion comment |

---

## Section 4: Skills & Agents

### `initiative-planner` Skill

**Trigger:** User provides a product brief describing work to be done.

**Input sources** (skill detects type automatically):
- Freeform text pasted directly into the prompt
- Path to a local markdown file (skill reads via `Read` tool)
- GitHub Discussion URL (skill fetches via CLI `tdd get` or GitHub MCP)
- Confluence page URL (future — Jira backend)

**Flow:**
1. Ingest and normalize the brief from whatever source was provided
2. Dispatch `system-architect` agent — evaluates the brief against the codebase, proposes a solution shape
3. Dispatch `senior-engineer` agent — refines the architect's proposal with PM context, produces a list of atomic tasks
4. Present the task list, solution overview, and effort estimate to the user
5. On user approval, run CLI commands to create all tracker artifacts (epic, TDD, one ticket per task)

### `ticket-planner` Skill

**Trigger:** User wants to deep-dive one task into a junior-engineer-ready implementation spec.

**Flow:**
1. Receive a ticket ID or task description
2. Read relevant areas of the codebase for implementation context
3. Ask clarifying questions interactively until the implementation path is unambiguous
4. Produce a tech writeup at junior-engineer level — specific enough to implement without guessing
5. On user approval, create or update the ticket body via CLI

### Agents

| Agent | Role | Invocation |
|---|---|---|
| `system-architect` | Evaluates the initiative against the codebase; proposes a solution that fits the existing architecture | Dispatched inside `initiative-planner` |
| `senior-engineer` | Refines the architect's proposal; works with the PM brief to break work into atomic tasks | Dispatched inside `initiative-planner` |
| `product-engineer` | Implements tickets exactly as the spec describes | Standalone — invoked during implementation |
| `code-reviewer` | Reviews PRs produced by the product-engineer; uses `code-reviewer-formatter` to process developer replies back into actionable feedback | Standalone — invoked during review |

---

## Section 5: Distribution & Release

### Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "flight-rules",
  "version": "0.1.0",
  "description": "PM-to-engineering pipeline for Good Ground Collective",
  "repository": "https://github.com/good-ground-collective/flight-rules",
  "skills": "./skills/",
  "agents": "./agents/"
}
```

### Installation

The plugin is distributed from a private GitHub repository. Collaborators need a `GITHUB_TOKEN` with read access to `good-ground-collective/flight-rules`.

> **Note for implementation:** The exact `/plugin install` syntax for private non-marketplace repos requires verification. It may require registering a lightweight private marketplace entry pointing at `good-ground-collective/flight-rules`, or Claude Code may support direct GitHub repo installs. This is the first implementation task to resolve.

### Release Flow

1. Developer runs `npm run build`, commits updated `bin/flight-rules`
2. PR opens — CI runs:
   - TypeScript typecheck (`tsc --noEmit`)
   - Build freshness check (`npm run build && git diff --exit-code bin/`)
   - Lint (`npx eslint src/`)
3. PR merges to `main`
4. `semantic-release` creates a follow-up commit that bumps the version in both `package.json` and `.claude-plugin/plugin.json`

### Build Script

The existing esbuild config needs one update — the output filename should match the binary name:

```json
{
  "build": "esbuild src/index.ts --bundle --platform=node --outfile=bin/flight-rules && chmod +x bin/flight-rules"
}
```

---

## Open Questions

1. **Private plugin install syntax** — needs verification before collaborators can install. May require a private marketplace registration step.
2. **Jira backend** — deferred. Interface is designed to support it; implementation follows when needed.
3. **Confluence TDD fetching** — deferred. GitHub Discussion fetching ships first; Confluence follows with the Jira backend.
