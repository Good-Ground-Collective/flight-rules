# flight-rules

flight-rules is a plugin for Claude Code and Codex that takes work from "I want to build X" to a reviewed pull request. It gives the agent a set of skills for each stage: agreeing on what to build, breaking it into tickets grounded in the real code, building each ticket with an independent verifier, reviewing the PR, and checking the result in the running product.

Every stage writes to your tracker (GitHub Issues or Jira) through one CLI, so the next stage, or the next engineer, can pick the work up from the tracker alone.

## The workflow

```text
/new ──► /break-down-work ──► /execute-work  (or /execute-wave) ──► review ──► /verify-ticket
 agree on      one level down,       build, verify, open         guided or       check it in the
 the work      grounded in code      the PR, self-review         autonomous      running product
```

1. **`/new`** interviews you about what you want to build. It asks one question at a time, each with a recommended answer, until you both agree on the problem, the must-haves, what can wait, what's out of scope, and the traps. When there's a lot to settle, it opens an interactive page with diagrams, mocks and questions you can answer with a toggle or free text. It sizes the work as a ticket, epic or initiative and writes it to the tracker. Point it at an existing initiative, epic or ticket to add to it instead.
2. **`/break-down-work <type> <id>`** (e.g. `epic 31`) takes a node one level down (initiative → epics, epic → tickets), researches the code for each piece, and writes tickets that another engineer could build with nothing but the ticket.
3. **`/execute-work <id>`** builds one ticket: branch, implement, verify each acceptance criterion with a separate agent, open the PR, then review and fix it. **`/execute-wave <id>`** does that for every ticket in an epic that nothing is blocking, then stops so you can merge.
4. **`/guided-code-review`** walks a human reviewer through a PR. **`/remediate-review`** works the open review threads.
5. **`/reproduce-bug`** and **`/verify-ticket`** reproduce a bug or confirm a fix in the running product, with screenshots and a recording.

`/draft-request-for-comments` is still there for work that needs comments from other people before it starts. It writes an RFC and opens it as a PR for review. For most work, start with `/new`.

## Requirements

- Claude Code or Codex.
- Node.js and `git`.
- The GitHub CLI, `gh`, logged in. Pull requests always go to GitHub, even when the tracker is Jira.
- For the QA skills only: `playwright-cli` and `ffmpeg`.

## Install

### Claude Code

```sh
claude plugin marketplace add Good-Ground-Collective/flight-rules
claude plugin install flight-rules@flight-rules
```

Or, inside a session, `/plugin marketplace add Good-Ground-Collective/flight-rules` and then `/plugin install flight-rules@flight-rules`.

Start a new session. The skills show up as `/flight-rules:<skill>`, and the plugin's `flight-rules` CLI is on the session's PATH. To use the CLI from your own terminal, add the plugin's `bin` directory (shown by `claude plugin list`) to your PATH.

Update with `claude plugin update flight-rules@flight-rules`.

### Codex

```sh
codex plugin marketplace add Good-Ground-Collective/flight-rules
codex plugin add flight-rules@flight-rules
```

Or use `/plugins` inside Codex. Then do two more things that Codex needs and Claude Code doesn't:

1. **Register the worker agents.** The plugin loads the skills, but Codex registers custom agents separately. Put the installed plugin's `bin` directory on your PATH (the install output shows the cache path), then, from your repository root:

   ```sh
   flight-rules agents install --scope project
   flight-rules agents status --scope project
   ```

   `--scope project` writes to `.codex/agents`; `--scope user` writes to `~/.codex/agents`. Install never overwrites a definition that differs. If an upgrade changes one, back up the old file, remove it, and install again.

2. **Trust the repository and the hooks.** Trust the actual checkout you'll work in, then start a fresh session. Trust the plugin's hooks once in `/hooks`.

If you run the generic npm CLI rather than the one in the Codex plugin, also set `FLIGHT_RULES_HOST=codex`.

More detail, including sandbox troubleshooting, is in [docs/native-installation.md](docs/native-installation.md).

## Environment variables

Credentials live in your environment, never in flight-rules config files.

| Variable | When you need it |
| --- | --- |
| `GITHUB_TOKEN` | GitHub tracker. Needs `repo` scope, and `read:org` for listing reviewers. `gh` also uses it when set, ahead of its own login, so PRs are opened as the token's account. |
| `GH_TOKEN` | Optional. Takes precedence over `GITHUB_TOKEN` for `gh` (PRs and reviews) only. Set it when PRs should come from a different account than tracker writes. |
| `JIRA_TOKEN` | Jira tracker. An Atlassian API token, which also covers Jira Product Discovery and Confluence. `JIRA_API_TOKEN` or `JIRA_API_KEY` work too. Can be set up [here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_EMAIL` | Optional. The Atlassian account that owns the token. Setup stores it in config as `jiraEmail`; the variable overrides that. |
| `JIRA_HOST` | Optional. Overrides the `jiraHost` config value, e.g. `acme.atlassian.net`. |
| `FLIGHT_RULES_HOST` | Optional. `claude` or `codex`. Only needed with the generic npm CLI; the plugin CLIs know their host. |
| `FLIGHT_RULES_CONFIG` | Optional. Points the CLI at one specific config file, for example to use a different tracker for a single repository. |

Put the token exports in your shell profile so every session sees them. If you use 1Password, `op run` works.

## Set up

In your repository, run:

```text
/flight-rules:setup
```

It asks which tracker you use, checks your credentials, writes the configuration with `flight-rules config set`, and runs a smoke test. Shared values such as the tracker, Jira host and project go in user scope, so a second repository usually only needs its `repo`. It can also scaffold a `QA.md` for the QA skills.

To see what's configured and where each value comes from:

```sh
flight-rules config show
flight-rules check
```

## Your first session

Paste this into a new session in a repository you've set up:

```text
I just installed the flight-rules plugin and want to understand the workflow it
promotes before I use it on real work. Explain the stages from /new to
/verify-ticket in plain terms: what each skill does, what it writes to my
tracker, and where it stops and waits for me. Then ask me about how I work
today — how I plan, size and track work, how my team reviews code, and where
things usually go wrong — and tell me honestly where flight-rules fits that,
where it would change my habits, and which parts I should try first. Ask one
question at a time.
```

When you're ready to try it on real work, run `/flight-rules:new` with an idea, a file, or an existing ticket.

## Skills

| Skill | What it does |
| --- | --- |
| `new` | Interviews you until you agree on the work, sizes it, and writes it to the tracker. Also adds to existing work. |
| `draft-request-for-comments` | Writes an RFC for work that needs others' comments, and opens it as a PR. |
| `break-down-work` | Takes a node one level down into code-grounded epics or tickets. |
| `execute-work` | Builds one ticket into a verified, self-reviewed PR. |
| `execute-wave` | Runs `execute-work` on every unblocked ticket in an epic or initiative. |
| `guided-code-review` | Walks a human through a PR and leaves a pending review. |
| `autonomous-code-review` | Unattended PR review for CI and remediation loops. |
| `remediate-review` | Fixes and replies to open review threads on a PR. |
| `review-prose` | Reviews or rewrites docs, tickets and PR text so they read like a person wrote them. |
| `reproduce-bug` | Reproduces a bug in the running product and documents it on the ticket. |
| `verify-ticket` | Checks a landed fix or story in the running product. |
| `capture-evidence` | Takes screenshots and a recording for the QA skills. |
| `sharpen-the-saw` | Writes a failing test suite for a ticket a human will implement. |
| `setup` | Configures flight-rules for a repository. |

## Technical design docs

When an epic needs more context than fits in its body, `break-down-work` publishes a technical design doc (TDD) and links it from the tickets. On Jira it's a Confluence page in the space named by `confluenceSpaceKey`, which setup doesn't ask for yet (`flight-rules config set confluenceSpaceKey ENG --scope user`); on GitHub it's a Discussion in a "TDDs" category. The skills manage these for you, and the same commands are there when you want to do it by hand:

```sh
flight-rules tdd create --title "Payments retry design" --body-file tdd.md --epic-id FRT-340
flight-rules tdd get <id>
flight-rules tdd edit <id> --body-file tdd.md
flight-rules tdd edit <id> --title "Payments retry design v2"
flight-rules tdd comment <id> --body "Reviewed with the team; going with option B."
```

- `tdd edit` changes the title, the body, or both. Leave one out and it stays as it is.
- `tdd comment` adds a comment. On Confluence it's a footer comment, and `tdd get` returns comments with their replies.
- `--attach <path>#<caption>` on `tdd create` and `tdd edit` uploads a file to a Confluence page. Reference it in the body as `![caption](attachment:<file>)` to show it inline. Edits keep images already on the page. GitHub Discussions have no attachment API, so `--attach` fails there.
- Bodies are markdown. On Confluence they're stored as formatted pages, so headings, tables, code blocks and `<details>` sections render properly.

## Further reading

- [Layered body format](docs/layered-body-format.md): the shape of every epic and ticket.
- [Native installation](docs/native-installation.md): install and config details for each host.
- [QA instructions](docs/qa-instructions.md): what goes in a repository's `QA.md`.
- [Coding charter](docs/coding-charter.md) and [prose charter](docs/prose-charter.md): the standards the agents write and review against.
- [Usage handoff](docs/usage-handoff.md): passing work between Claude Code and Codex when a usage limit runs out.
