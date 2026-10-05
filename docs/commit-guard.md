# Commit Guard

The plugin ships a `PreToolUse` hook (`hooks/hooks.json`) that stops an agent from committing with raw `git commit` in a repo that uses flight-rules. Commits made that way skip the conventional subject, the body, and the version trailers that `flight-rules git commit` writes, and a squash merge of such commits produces a PR body that is only trailers.

## When it fires

The hook runs on Bash tool calls that start with `git`. It blocks the call when all of these hold:

- Some part of the command is `git … commit`, including after `&&`, `;`, a pipe, or inside a subshell, and with global options such as `-C dir` before `commit`.
- The commit writes a message: it does not pass `--no-edit`. Finishing a merge or `git commit --amend --no-edit` is allowed.
- The project has flight-rules config. The hook asks the same store as `flight-rules config show`, looking in `$CLAUDE_PROJECT_DIR` (else the payload's `cwd`). A repo with no config in any layer is never affected.
- The command does not set `FLIGHT_RULES_RAW_GIT=1`.

A blocked call does not run. Claude receives the reason, which names the `flight-rules git commit` invocation and the bypass, and normally retries through the CLI.

## Bypass

Prefix the command with `FLIGHT_RULES_RAW_GIT=1` (or `export` it earlier in the same command) when raw git is genuinely right, for example a commit the CLI cannot express. The reason text asks the agent to say why it bypassed.

## Limits

Command parsing is best-effort. It does not see commits made inside a script the command runs, through a shell alias, or by a tool other than Bash. Any failure inside the hook (unreadable stdin, invalid settings JSON) allows the command, so the guard can never break the shell. The hook only changes how agents commit; your own terminal is unaffected.
