# Usage handoff

When a Claude Code or Codex session reaches its plan's session or weekly usage limit, the work stops until the window resets. The `usage-handoff` Stop hook passes the unfinished work to the other harness, and takes it back when the limit resets. One implementation serves both directions. In Claude Code the hook needs no setup beyond installing the plugin. Codex also needs you to trust it once in `/hooks` (see [Hosts](#hosts)).

The hook is `flight-rules hook usage-handoff --harness claude-code|codex`. The hand-over runs through `hc` terminals, so it works when both agents run in the same Herdr space; outside `hc` it only writes the handoff file.

## What happens

1. At the end of each turn the hook reads its own harness's usage: the session and weekly windows. Reads are cached for 60 seconds. A failed read does nothing.
2. Below the threshold, nothing happens. At or above it, the busier window decides: its percent triggers, and its reset time is the one used below.
3. The hook keeps the agent going for one more turn with an instruction to write a handoff file and then stop. The file holds the remaining tasks, branch, ticket or PR, current state, working directory and the reset time. It lives at `$XDG_STATE_HOME/flight-rules/handoffs/<harness>-<session_id>.md` (default `~/.local/state/flight-rules/handoffs/`).
4. On the next Stop the hook delivers it. It sends the handoff to an idle agent of the other harness in the same Herdr space (`hc send`), or else starts one there (`hc run --bg`, labeled `herdr.space=<space>`). An agent counts as idle when `hc ls` reports its status as `idle` or `done`.
5. It then starts a waiter terminal (`hc run --bg`, running `flight-rules handoff wait`). At the reset time the waiter asks the stand-in for a handback file, waits for it to finish (`hc wait`), and sends the handback to the original terminal. The waiter is an `hc` terminal, so it keeps running with no multiplexer window open.

### Short windows

When the reset is less than the cutoff away (default 10 minutes) the work is not moved. The agent stops where it is, and the waiter sends it "Usage has reset. Continue the work you were doing before you stopped." once the window rolls over.

### Guards

- If the other harness is also at or above the threshold, the hook doesn't hand off. It tells the user instead and does not try again in that window.
- Without `HC_TERMINAL_ID` (not running in `hc`) the hook writes the handoff file and tells the user its path. Nothing is delivered. The same happens when `hc` is missing or a call to it fails.
- A terminal with no `herdr.space` label never borrows or starts an agent, so work never lands outside the space it belongs to.
- A session gets one handoff per usage window. The record is `<harness>-<session_id>.json` beside the handoff file, and it stops applying once the window it was made for has reset.
- If the agent doesn't write the handoff file, nothing is delivered.
- The hook never fails the session. Any error exits 0 and lets Stop proceed.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `usageHandoffThreshold` | `95` | Percent of a window at which the hook hands off. |
| `usageHandoffMinResetMinutes` | `10` | The cutoff: with fewer minutes than this to the reset, skip the handoff and only wake the original agent after the reset. |

Set them like any other flight-rules setting, for example `flight-rules config set usageHandoffThreshold 90`.

## Where usage comes from

Neither source is a documented API, and either can change without notice. Each harness has one reader class in `src/hooks/usage-handoff/usage-reader.ts`, so an endpoint change is a one-place fix. If a reader breaks, its harness quietly stops handing off.

| Harness | Source |
| --- | --- |
| Claude Code | `GET https://api.anthropic.com/api/oauth/usage` with the OAuth token Claude Code stores (macOS Keychain item `Claude Code-credentials`, else `~/.claude/.credentials.json`) and `anthropic-beta: oauth-2025-04-20`. Reads `five_hour` and `seven_day`, each `utilization` (percent used) and `resets_at`; either may be null. |
| Codex | `GET https://chatgpt.com/backend-api/wham/usage` with the token and account id in `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`). Windows are classified by `limit_window_seconds` (under a day is the session window, otherwise weekly), because some plans report only a weekly window as `primary`. |
| Codex fallback | If that read fails, the newest `$CODEX_HOME/sessions/**/rollout-*.jsonl` line with `rate_limits`. It is only as fresh as Codex's last turn. |

Tokens are read only to make the request. They are never written anywhere or printed.

## Hosts

**Claude Code** registers the hook on Stop in `hooks/hooks.json`. Its `{"decision": "block", "reason": ...}` reply keeps the agent working for another turn, and `systemMessage` shows the user a note.

**Codex** registers the same hook on Stop in `adapters/codex/hooks.json`, and runs it only after you trust it in `/hooks`. Codex's Stop hook can continue the agent for one more turn: it accepts the same `{"decision": "block", "reason": ...}` reply and turns the reason into the next prompt (checked against codex-cli 0.166.0, whose Stop handling logs "Stop hook requested continuation without a prompt; ignoring the block" when a block has no reason). No SessionEnd fallback is needed. If a future Codex version stops honoring the block, the hook would find no handoff file on the next Stop and deliver nothing; the fallback then is to deliver from SessionEnd or on the next turn.

## Files

| Path | Content |
| --- | --- |
| `handoffs/<harness>-<session_id>.md` | The handoff the agent writes. |
| `handoffs/<harness>-<session_id>.handback.md` | The handback the stand-in writes at the reset. |
| `handoffs/<harness>-<session_id>.json` | The hook's record for the session: phase (`requested`, `delivered`, `written`, `waiting` or `declined`), the window's reset time, and the stand-in and waiter terminals. |
| `usage/usage-<harness>.json` | The 60-second usage cache. |

All of it is under `$XDG_STATE_HOME/flight-rules/` (default `~/.local/state/flight-rules/`).
