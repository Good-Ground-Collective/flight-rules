# Codex sandbox diagnostics

Use this guidance only in a Codex session when its supplied policy or an operation failure identifies a filesystem or network restriction. It adds no workflow gate and requires no runtime JSON file.

Codex’s sandbox limits file and network access for spawned commands, while its approval policy controls requests to cross those boundaries. Use the running session’s policy and exposed tools; a configuration file or plugin installation alone does not establish effective access. See the [official sandbox documentation](https://learn.chatgpt.com/docs/sandboxing).

- Check the active checkout and the specific path or host involved in the failure. Git metadata for a linked worktree can be outside the working directory.
- Respect an explicit session denial before attempting the affected operation. When the current tool supports scoped approval, use that normal path for the authorized operation. In an unattended workflow, return the missing access instead of prompting.
- Report authentication and service failures separately. DNS errors or connection refusal alone do not prove sandbox denial. Successful remote reads do not establish permission to push.
- If the session cannot support the operation, report the exact boundary and the scoped access needed. Do not disable the sandbox, change approval policy or broaden permissions as a side effect of a skill.

The harness enforces the resulting decision. Do not translate it into a second permission manifest or require observations about unrelated future operations.
