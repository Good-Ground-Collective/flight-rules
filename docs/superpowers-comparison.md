# Flight Rules vs Superpowers — a competitive read

_Compiled July 2026. Flight Rules characterization drawn from the plugin's own skills,
CLI, and coding charter as of the KAN-28 epic merge (`main` @ 50a10f2). Superpowers
characterization drawn from [obra/superpowers](https://github.com/obra/superpowers)
(v6.2.0, ~14 core skills)._

## Thesis

They solve adjacent problems, not the same one. **Superpowers accelerates one builder's
dev loop** with auto-firing skills; **Flight Rules governs a team's PM-to-engineering
pipeline**, grounded in a real tracker. The most valuable borrowings from Superpowers are
ergonomic, not architectural — and there's a real risk in copying the wrong ones.

| | Flight Rules (this plugin) | Superpowers (obra / Jesse Vincent) |
|---|---|---|
| **What it is** | A governed "software factory": RFC → epic → ticket → execute, grounded in a real tracker | A composable skills library + bootstrap instructions that make the agent use them |
| **Footprint** | ~6 skills, 3 agents, a TypeScript CLI | ~14 core skills, auto-activating |
| **Grounding** | Jira / GitHub / JPD / Confluence as source of truth | Local plan files |
| **Discipline** | Coding charter (M-1…M-13) + guided review | TDD-first (red-green-refactor) |
| **Stance** | Human-gated, team governance | Zero-infra, solo accelerator |
| **Reach** | Claude Code only | Multi-platform (Cursor, Gemini, Copilot, Codex, …) |

## 1. What Superpowers has that we don't

Mostly ergonomics and general engineering hygiene — the layers Flight Rules skipped to
focus on process.

- **Automatic skill activation.** A `SessionStart` hook injects a primer, and skills fire
  off their own description/keyword triggers plus a `skills-search` tool — the agent
  reaches for the right skill without being told. Flight Rules makes you know and type
  `/break-down-work`. _(Biggest gap.)_
- **A meta-skill for writing skills.** `writing-skills` gives a guided way to author new
  skills in-house, so the framework grows itself. Flight Rules' authoring conventions are
  implicit and have to be reverse-engineered from existing `SKILL.md` files.
- **Always-on dev hygiene.** `test-driven-development` (watch the test fail first),
  `systematic-debugging`, and `verification-before-completion` are reusable, always-available
  skills. Flight Rules' quality lives in a charter and a single review pass — not portable
  disciplines the agent applies everywhere.
- **Git-worktree parallel isolation.** `using-git-worktrees` + `dispatching-parallel-agents`
  give real parallel subagents on isolated trees. Flight Rules has no worktree story — the
  serial fallback when fanning out the KAN-28 tickets was caused by exactly this absence.
  _(Session-proven need.)_
- **Zero-infrastructure adoption.** Pure skills: install and it works. Flight Rules asks a
  team to wire up a tracker, credentials, a CLI build, and a charter before the first payoff.
- **Platform portability.** Runs across Claude Code, Cursor, Gemini CLI, Copilot CLI, Codex.
  Flight Rules is Claude-Code-only by construction.
- **Composability over linearity.** Skills combine freely and re-enter in any order. Flight
  Rules is a fixed pipeline — powerful for governance, rigid when work doesn't fit the ladder.
- **A continuous-improvement loop.** Self-updating notes (and famously a "feelings journal")
  let the agent record what worked and carry it forward. Flight Rules has durable memory but
  no structured retro step.

## 2. What we have that they don't

The governance and organizational layers that make Flight Rules a team product, not a solo
accelerator.

- **Tracker-grounded work.** Jira, GitHub, JPD and Confluence behind one abstraction. Work
  persists as natively-linked epics and tickets with real dependency graphs and planner
  waves. Superpowers plans live in local files that vanish with the branch.
- **A modeled PM process.** Human-authored, sized RFC → initiative / epic / ticket
  decomposition, each grounded in real code by a parallel research fan-out. Superpowers goes
  idea → plan → code but doesn't model organizational altitudes or the PM handoff.
- **A codified coding charter.** Thirteen mandates (M-1…M-13) ground every line of agent code
  and every review — services over loose functions, Zod-validated boundaries, domain
  modeling. Superpowers enforces TDD and simplicity but has no architectural charter.
- **Deterministic, schema-validated operations.** `git commit`, `pr create`, `ticket status`
  and branch naming are Zod-validated CLI commands — reproducible and testable, not the agent
  hand-rolling `git`/`gh` a little differently each run.
- **Human-final verdicts.** Nothing proceeds without a merged RFC; the breakdown is previewed
  before any node is created; guided review posts a **PENDING** review a human finalizes.
- **Sharpen-the-saw.** A deliberate mechanism to keep foundational work in human hands —
  TDD-fenced tickets handed to engineers so skills don't atrophy. A genuine org/people concern
  Superpowers doesn't touch. _(Distinctive edge.)_
- **Layered-body artifacts.** One document serves three readers — human intent up top, an
  implementer walkthrough in the middle, round-trippable machine metadata below.
- **Multi-tracker by config.** The same pipeline runs on GitHub or Jira via one config switch;
  the tracker-agnostic CLI resolves the rest.

## 3. Learnings to adopt, in priority order

Borrow the ergonomics; keep the governance. Ranked by return on effort.

1. **Auto-activation + a SessionStart primer.** Keep the explicit `/commands`, but add
   description-triggered activation and a skills-search so the pipeline surfaces itself
   instead of relying on the user to memorize it. Highest ergonomic payoff by far.
2. **Adopt git-worktree isolation for execute-work.** Bring in the `using-git-worktrees`
   pattern so the forthcoming **KAN-35 execute-work skill** can run agents truly in parallel.
   A validated, concrete need — not hypothetical.
3. **Make execution disciplines always-on skills.** Fold TDD-first (watch it fail) and
   verification-before-completion into the code-implementation / code-verifier loop as
   explicit, reusable skills. The verifier is close; make "prove it, don't claim it" a
   first-class discipline.
4. **Write a "writing-a-flight-rules-skill" meta-skill.** Codify the conventions (frontmatter
   shape, guardrails, CLI-only tracker access, What-Good-Looks-Like) so the pipeline is
   self-extending and new skills stay consistent by construction.
5. **Offer a zero-infra "lite" mode.** Let a team get value from the skills — review,
   breakdown thinking, execution discipline — before wiring up a tracker, credentials, and the
   CLI. Closes most of Superpowers' adoption-floor advantage without giving up the governed mode.
6. **Add a retro / reflection step.** Capture what worked each cycle into durable memory — a
   lightweight structured retro after execute-work, cheap to add on top of existing memory.

## The stance

Don't trade governance for magic. Superpowers optimizes a solo builder's loop — auto-firing
skills, worktrees, always-on quality — and those ergonomics are worth borrowing outright. But
Flight Rules' tracker-grounding, coding charter, and human-in-the-loop gates aren't friction to
sand off; they're the entire point for a **team**. Adopt the activation model and the worktree
parallelism; keep the RFC gate, the charter, and the human's final verdict. The win is a
pipeline that's as easy to reach for as Superpowers and as accountable as it already is.

## Sources

- [github.com/obra/superpowers](https://github.com/obra/superpowers) — repository, skills library, v6.2.0 manifest
- [blog.fsck.com/2025/10/09/superpowers](https://blog.fsck.com/2025/10/09/superpowers/) — Jesse Vincent's launch post & methodology
- [simonwillison.net/2025/Oct/10/superpowers](https://simonwillison.net/2025/Oct/10/superpowers/) — independent walkthrough of the mechanics
