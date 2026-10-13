# Commit Guard

The plugin ships a `PreToolUse` hook (`hooks/hooks.json`) that stops an agent from committing with raw `git commit` in a repo that uses flight-rules. Commits made that way skip the conventional subject, the body, and the version trailers that `flight-rules git commit` writes, and a squash merge of such commits produces a PR body that is only trailers.

## When it fires

The hook runs on Bash tool calls that start with `git`. It blocks the call when all of these hold:

- Some part of the command is `git … commit`, including after `&&`, `;`, a pipe, or inside a subshell, and with global options such as `-C dir` before `commit`.
- The commit writes a message: it does not pass `--no-edit`. Finishing a merge or `git commit --amend --no-edit` is allowed.
- The project has its own flight-rules config: a `project` or `local` settings layer, or a config file. The hook asks the same store as `flight-rules config show`, looking in `$CLAUDE_PROJECT_DIR` (else the payload's `cwd`). Config at `user` scope alone does not count, because it applies to every repo on the machine.
- The command does not set `FLIGHT_RULES_RAW_GIT=1`.

A blocked call does not run. Claude receives the reason, which names the `flight-rules git commit` invocation and the bypass, and normally retries through the CLI.

## Bypass

Prefix the command with `FLIGHT_RULES_RAW_GIT=1` (or `export` it earlier in the same command) when raw git is genuinely right, for example a commit the CLI cannot express. The reason text asks the agent to say why it bypassed.

## Limits

Command parsing is best-effort. It does not see commits made inside a script the command runs, through a shell alias, or by a tool other than Bash. Any failure inside the hook (unreadable stdin, invalid settings JSON) allows the command, so the guard can never break the shell. The hook only changes how agents commit; your own terminal is unaffected.

## Attribution stripping

The same hook removes Claude Code's attribution from commit messages and PR bodies, in every repo, not only flight-rules ones. It rewrites `git commit`, `gh pr create`, `gh pr edit`, and `flight-rules git commit` / `pr create` commands before they run, dropping whole lines that are:

- `Co-Authored-By:` naming Claude or an `anthropic.com` address (human co-authors are kept),
- `Claude-Session: …`,
- a bare `https://claude.ai/code/session_…` link.

The rewrite carries no permission decision, so the command still goes through the normal permission flow. `flight-rules git commit` also drops these lines from `--body`, `--body-file`, and `--footer` itself, which covers a body written to a file the hook cannot see. A message written to a file and committed with raw `git commit -F <file>` keeps them; the guard sends those commits to the CLI in flight-rules repos anyway.

To stop Claude Code adding them in the first place, set this in `~/.claude/settings.json`:

```json
{ "attribution": { "commit": "", "pr": "", "sessionUrl": false } }
```
