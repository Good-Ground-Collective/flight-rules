# Ariadne Board

`flight-rules board` reports a run to the Agents page in Ariadne: which session is working which ticket, what step it is on, what it needs from a person (a question, a blocker, something to test, a wave gate), and a stream of activity lines. It talks to Ariadne's Agents API, contract version 1.

Reporting is opt-in twice. Ariadne must have Agents turned on for you (Ariadne › Settings › Connections), and this machine must have an Ariadne token. Without a token every `board` command does nothing and prints nothing.

## Set up

1. In Ariadne, open Settings › Connections, turn on Agents and create an agent token. Each machine needs its own agent token.
2. Give it to flight-rules in one of two ways:
   - export it as `ARIADNE_AGENT_TOKEN`, or
   - run `flight-rules board login` and paste it at the hidden prompt (or pipe it on stdin). The token is saved to `$XDG_CONFIG_HOME/flight-rules/ariadne-token` (default `~/.config/flight-rules/ariadne-token`) with mode 0600. `flight-rules board logout` deletes it.
3. Check it with a strict heartbeat, which exits 1 and prints the reason when anything is wrong:

   ```bash
   flight-rules board post heartbeat --ticket FRT-1 --step setup --state nominal --session setup-check --strict
   ```

The token is read from `$ARIADNE_AGENT_TOKEN`, then `$ARIADNE_TOKEN` (an interactive Ariadne access token, which the API also accepts), then the saved file. flight-rules never uses the `ariadne` CLI's Keychain session or any other sign-in. No token is ever printed or written into a repository.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `ariadne.url` | `https://ariadne-api-xohlbba2ea-uc.a.run.app` | The Ariadne API. It must be https; http is allowed only for `localhost` and `127.0.0.1`. |
| `ariadne.enabled` | `true` | Set `false` to stop reporting even when a token is set. |

Both keys can only be set in user scope (or the untracked local scope). They are ignored in project settings and the flight-rules config file. A repository's committed settings therefore can't redirect your token to another host or switch your reporting off. Write them with `flight-rules config set ariadne.url <url> --scope user`. A plain `config set` writes them to user scope when they are not already set elsewhere.

When an ignored or invalid value is found, `--strict` and `board items` print a one-line notice such as `ignored ariadne.url from project settings; set it in user scope`. Quiet posts print nothing. If `ariadne.url` is not a valid https URL, the board treats itself as not configured and sends nothing, so the token never goes to that URL.

## Commands

```bash
flight-rules board post heartbeat --ticket <key> --step <step> --state <nominal|caution|abort|hold> [--branch <branch>] [--repo <owner/name>] [--skill <skill>] [--detail <line>]
flight-rules board post item --kind <question|blocker|testable|wave-gate> --ticket <key> --title <text> [--detail <text>] [--option <label>]… [--id <id>]
flight-rules board post activity --ticket <key> --text <line> [--level <info|success|caution|abort>] [--id <id>]
flight-rules board items [--json]
```

Every `post` command and `board items` also take:

- `--session <id>`: the session to report on. It defaults to the Claude Code session id (`$CLAUDE_CODE_SESSION_ID`).
- `--strict`: exit 1 when the call fails. A missing token then counts as a failure, so the request is sent without one and the API's 401 is reported.
- `--json`: print the API response. For an item that is `{item, created}`, including any `chosenOption`; for `board items` it is `{items}`.

`--step` is one line of up to 60 characters, such as `implement`, `verify 2/3`, `pr` or `qa`. `--ticket` is a Jira issue key. A ticket that is not one, such as a GitHub issue number, is skipped quietly: Ariadne maps sessions to objectives through Jira, so a GitHub-tracked run reports nothing. `--strict` prints a one-line notice about the skip. An item takes up to six `--option` labels. Over-long text is cut to the API's limits and folded onto one line where the API wants one.

An item or activity line needs its session to exist. When the session has no heartbeat yet, the post sends one first (step `started`, state `nominal`) and then retries; a live session's step is never overwritten.

Reposting an item with the same `--id` (or, without one, the same kind, ticket and title) stores nothing new and returns the stored item with any answer, so a run can read a decision by posting its question again. `board items` lists every item of the session, open and resolved, with `chosenOption`. It is read-only: people answer items in Ariadne, and an agent token cannot answer them.

## Where runs report

The plugin's skills post at their step boundaries:

- `execute-work` sends a heartbeat at each step: `implement`, `verify <n>/3`, `qa`, `pr`, then `pr` with state `hold` once the PR waits for review. It posts an activity line when it opens the PR, and a heartbeat with state `abort` and the reason when a gate stops the run.
- `execute-wave` posts a `wave-gate` item (Start wave / Review wave) under the session `wave-<epic or initiative>` when it stops at a wave boundary. The next run reads the answer with `board items --session wave-<id> --json` before asking in chat.
- `verify-ticket` posts a `testable` item when it starts checking a deployed change, and an activity line with the verdict and the Agentic-Verification label it set.
- When a skill asks a closed question, it also posts it as a `question` item. The first answer wins, in chat or in Ariadne.

An Ariadne answer is always a person's: agent tokens can't answer items, so skills read answers and never give them.

### The heartbeat hook

Ariadne shows a session as stale 15 minutes after its last heartbeat, and a long implement step can be quiet for longer. The plugin's `PostToolUse` hook, `flight-rules hook board-heartbeat`, keeps the session alive between skill posts. A tool call works like this:

1. The hook reads the session id from the hook input. It then looks for the last heartbeat a skill posted for that session in `$XDG_STATE_HOME/flight-rules/board/<session>.json` (default `~/.local/state/flight-rules/board/`). That file holds the ticket, step and state, never a token.
2. It stops there, silently, when no skill has posted for the session, when the run aborted, when that post is more than an hour old, or when it sent one less than a minute ago.
3. Otherwise it starts a detached child process that re-sends that same heartbeat, and exits at once. The tool call never waits on the network, and the session's step is never overwritten.

When Ariadne is not configured, no skill heartbeat is ever recorded, so the hook does nothing.

## Failures

A failed call never fails the hook or skill that made it. Without `--strict`:

- not configured (no token) or `ariadne.enabled` false: no output, exit 0;
- any failure: one line on stderr starting `flight-rules board:`, exit 0.

The common lines say what to do next. `agents_opt_in_required` means Agents is off for you in Ariadne. `agent_token_expired` means the agent token passed its 90 days; create a new one and run `flight-rules board login`. A plain `401 unauthorized` means the token is not recognised (revoked or mistyped).

Each request times out after 5 seconds and is retried once when no response arrives or the server answers 5xx, so a call takes at most about 10 seconds. Retrying is safe because heartbeats are upserts and items and activity lines are keyed.

## What is sent

Only the fields above: session id, ticket key, step, state, branch, repo, skill, short detail lines, item titles and options, and activity lines. Never source code, diffs or ticket bodies. The request schemas are strict, so an unexpected field is refused before anything is sent.
