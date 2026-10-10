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
| `ariadne.url` | `https://ariadne-api-xohlbba2ea-uc.a.run.app` | The Ariadne API. |
| `ariadne.enabled` | `true` | Set `false` to stop reporting even when a token is set. |

`flight-rules config set ariadne.enabled false` writes to user scope unless the key is already set somewhere else.

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

`--step` is one line of up to 60 characters, such as `implement`, `verify 2/3`, `pr` or `qa`. `--ticket` is a Jira issue key. An item takes up to six `--option` labels. Over-long text is cut to the API's limits and folded onto one line where the API wants one.

An item or activity line needs its session to exist. When the session has no heartbeat yet, the post sends one first (step `started`, state `nominal`) and then retries; a live session's step is never overwritten.

Reposting an item with the same `--id` (or, without one, the same kind, ticket and title) stores nothing new and returns the stored item with any answer, so a run can read a decision by posting its question again. `board items` lists every item of the session, open and resolved, with `chosenOption`. It is read-only: people answer items in Ariadne, and an agent token cannot answer them.

## Failures

A failed call never fails the hook or skill that made it. Without `--strict`:

- not configured (no token) or `ariadne.enabled` false: no output, exit 0;
- any failure: one line on stderr starting `flight-rules board:`, exit 0.

The common lines say what to do next. `agents_opt_in_required` means Agents is off for you in Ariadne. `agent_token_expired` means the agent token passed its 90 days; create a new one and run `flight-rules board login`. A plain `401 unauthorized` means the token is not recognised (revoked or mistyped).

Each request times out after 5 seconds and is retried once when no response arrives or the server answers 5xx, so a call takes at most about 10 seconds. Retrying is safe because heartbeats are upserts and items and activity lines are keyed.

## What is sent

Only the fields above: session id, ticket key, step, state, branch, repo, skill, short detail lines, item titles and options, and activity lines. Never source code, diffs or ticket bodies. The request schemas are strict, so an unexpected field is refused before anything is sent.
