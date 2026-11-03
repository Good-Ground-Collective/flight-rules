# Sub-agent status files

Terminal multiplexers see terminals, not the sub-agents a session runs inside one. The plugin's hooks keep one JSON file per sub-agent run so a pane can list them under the terminal that started them. In Claude Code the hooks need no setup beyond installing the plugin. Codex also needs you to trust them once (see [Hosts](#hosts)). Everything stays local: no network, no output, and a failure never affects the agent.

## Where the files are

`$XDG_STATE_HOME/flight-rules/agents/` (default `~/.local/state/flight-rules/agents/`), one file per run named `<harness>-<session_id>-<agent_id>.json`, with every character outside `[A-Za-z0-9._-]` replaced by `_`. Each write goes to a temp file in the same folder and is renamed into place. The folder also holds dotfiles that are not records: temp files, and `.<record>.done` / `.<record>.error` markers. Readers should only read names that end in `.json` and don't start with a dot.

Hook processes can run at the same time, for example a sub-agent's last tool call next to its stop, or SessionEnd next to a failure. So a finished state doesn't depend on which rename lands last. An end creates its marker with an exclusive create before it writes the record. Every writer re-reads the markers after its rename and rewrites the record if they disagree. An error outranks done.

```json
{
  "v": 1,
  "harness": "claude-code",
  "hc_terminal": "t3",
  "session_id": "fb8583e4-97fb-4c10-83a9-5decbb6e3fe9",
  "agent_id": "a4d2cf1a84e1a827a",
  "agent_type": "code-verifier",
  "description": "Verify FRT-1234 acceptance criteria",
  "ticket": "FRT-1234",
  "status": "working",
  "cwd": "/Users/me/Developer/repo",
  "started_at": "2026-11-03T14:00:00Z",
  "updated_at": "2026-11-03T14:00:00Z",
  "ended_at": null
}
```

| Field | Source |
| --- | --- |
| `harness` | `claude-code` or `codex`, from the hook registration. |
| `hc_terminal` | `$HC_TERMINAL_ID`, or `null`. |
| `session_id` | The parent session from the hook payload. |
| `agent_id`, `agent_type` | The hook payload; `agent_type` is `subagent` when the host sends none. |
| `description` | The dispatch description, at most 120 characters. Claude Code: the sub-agent's `meta.json` sidecar, or `background_tasks` on SubagentStop. Codex sends none, so it stays empty. |
| `ticket` | The first Jira-shaped key in the description, then in the sub-agent's first prompt, then in the branch checked out in `cwd`. Otherwise `null`. |
| `status` | `working`, `done` or `error`. |

## Lifecycle

| Event | Effect |
| --- | --- |
| SubagentStart | Writes the record as `working`. |
| PostToolUse in a sub-agent | Refreshes `updated_at`, at most every 30 seconds, and fills in a description or ticket that wasn't available at start. It never reopens a finished record. |
| SubagentStop | Sets `done`, or `error` if the payload reports a failed task, and sets `ended_at`. |
| StopFailure in a sub-agent (Claude Code) | Sets `error`. A later SubagentStop keeps it. |
| SessionEnd | Marks the session's still-`working` records `done`. |
| Every run | Deletes records whose `ended_at` (or, while working, `updated_at`) is more than 24 hours old, and leftover temp or unreadable files older than that. |

## Hosts

**Claude Code** registers the hooks in `hooks/hooks.json` with the plugin's other hooks. Sub-agent payloads carry the parent's `session_id` and a unique `agent_id`, which pairs SubagentStart with SubagentStop. Claude Code doesn't flag a failed sub-agent on SubagentStop, so a run shows `error` only when StopFailure fires inside it or a background task reports `failed`.

**Codex** loads `hooks/hooks.json` from the Codex plugin package (source: `adapters/codex/hooks.json`). It registers SubagentStart, SubagentStop, PostToolUse and SessionEnd. Codex runs plugin hooks only after you trust them in `/hooks`, and the trust is tied to the plugin's contents, so you trust them again after each plugin update. Codex sends no description, prompt or failure status for a sub-agent, so a Codex record has an empty `description`, takes its ticket from the branch only, and ends as `done`.
