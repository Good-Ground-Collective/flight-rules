---
name: setup
description: "First-run setup for the flight-rules plugin. Creates .claude/flight-rules.local.md with the correct fields and verifies the environment is ready to use."
---

# Setup

This skill creates the per-project configuration file for flight-rules and verifies your environment is ready. It takes about two minutes. Run it once per repository you want to use the plugin in.

If `.claude/flight-rules.local.md` already exists, read it and show the current values before asking whether to reconfigure.

---

## Step 1: Verify the binary

Run:

```bash
flight-rules --help
```

If this fails, the binary is missing or not in PATH. Tell the user:

> "The flight-rules binary isn't reachable. Make sure the plugin is installed (`claude plugin list`) and that `${CLAUDE_PLUGIN_ROOT}/bin` is in your PATH, or run commands via the full path `${CLAUDE_PLUGIN_ROOT}/bin/flight-rules`."

Stop if the binary is not working.

---

## Step 2: Check GITHUB_TOKEN

Run:

```bash
echo "${GITHUB_TOKEN:+set}"
```

If the output is empty, tell the user:

> "GITHUB_TOKEN is not set. Export it before continuing:
> ```bash
> export GITHUB_TOKEN=ghp_your_token_here
> ```
> The token needs `repo` scope for task tracker operations and `read:org` scope for `flight-rules users get`."

Stop if the token is not present.

---

## Step 3: Collect configuration

Ask each question in order. Keep it conversational — one question at a time.

**Repo**
> "Which GitHub repository will this project track issues in? Use `org/repo` format (e.g. `Good-Ground-Collective/my-project`)."

Validate that the input contains exactly one `/`.

**RFC storage**
> "Where should RFCs be saved — locally in this project's `rfcs/` folder, or in a shared global RFC repository?"

- If local: no follow-up needed.
- If global: ask for the path:
  > "What's the absolute path to your RFC repository? (e.g. `/Users/seth/rfcs`)"

**Default labels** (optional)
> "Any default labels to apply to every issue created from this project? Hit enter to skip."

If they provide labels, split on commas and strip whitespace. If they skip, use an empty list.

---

## Step 4: Write the config file

Create `.claude/` if it doesn't exist. Write `.claude/flight-rules.local.md`:

**Local RFC storage:**

```markdown
---
tracker: github
repo: <repo>
defaultLabels:
  - <label1>
  - <label2>
rfcStorage: local
---
```

**Global RFC storage:**

```markdown
---
tracker: github
repo: <repo>
defaultLabels:
  - <label1>
  - <label2>
rfcStorage: global
rfcStoragePath: <path>
---
```

Omit the `defaultLabels` block entirely if the user skipped that step.

---

## Step 5: Smoke test

Run:

```bash
flight-rules users get
```

- If it returns a JSON array (even empty): setup is complete. Tell the user:
  > "Setup complete. `flight-rules` is configured for `<repo>`. Try `/draft-spec` to author your first RFC."
- If it returns an error: show the error and explain likely causes:
  - 401/403 — token lacks `read:org` scope or doesn't have access to the org
  - 404 — the org in the repo field doesn't exist or the token can't see it
  - Parse error — the config file was written incorrectly; show the file and offer to fix it
