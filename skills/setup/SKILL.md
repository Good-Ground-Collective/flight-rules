---
name: setup
description: "First-run setup for the flight-rules plugin. Creates .claude/flight-rules.local.md with the correct fields and verifies the environment is ready to use."
---

# Setup

This skill creates the per-project configuration file for flight-rules and verifies your environment is ready. It takes about two minutes. Run it once per repository you want to use the plugin in.

The config file is `$FLIGHT_RULES_CONFIG` when that variable is set, otherwise `.claude/flight-rules.local.md`. The CLI honours the override, so every read and write below means whichever path is in effect.

If that file already exists, read it and show the current values before asking whether to reconfigure.

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

## Step 2: Choose the task tracker

Ask:

> "Which task tracker will this project use — **GitHub** (Issues) or **Jira** (Jira + Jira Product Discovery + Confluence)?"

The rest of setup branches on this answer. Follow **Step 3–6 (GitHub)** or **Step 3–6 (Jira)** accordingly.

---

## Step 3 (GitHub): Check GITHUB_TOKEN

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

## Step 4 (GitHub): Collect configuration

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

**QA lane** (optional)
> "Will this repo use the QA lane (`capture-evidence`, `reproduce-bug`, `verify-ticket`)? If yes, where should the QA recipe live? Hit enter for the default, `.claude/flight-rules.qa.md`."

A relative answer resolves against the config file's directory; an absolute path is used as is. Remember the answer for Step 5 and Step 7.

## Step 5 (GitHub): Write the config file

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

Add `qaRecipe: <path>` only when the user chose a non-default location. The default needs no key.

## Step 6 (GitHub): Smoke test

Run:

```bash
flight-rules users get
```

The command prints a JSON array of `{ accountId, displayName }` pairs — the `accountId` addresses a user in a mention, the `displayName` is what a human reads.

- If it returns a JSON array (even empty): setup is complete. Tell the user:
  > "Setup complete. `flight-rules` is configured for `<repo>`. Try `/draft-request-for-comments` to author your first RFC."
- If it returns an error: show the error and explain likely causes:
  - 401/403 — token lacks `read:org` scope or doesn't have access to the org
  - 404 — the org in the repo field doesn't exist or the token can't see it
  - Parse error — the config file was written incorrectly; show the file and offer to fix it

---

## Step 3 (Jira): Check credentials

Jira, Jira Product Discovery, and Confluence all authenticate with one Atlassian API token plus the account email (HTTP Basic auth). Run:

```bash
echo "${JIRA_TOKEN:+token-set} ${JIRA_EMAIL:+email-set}"
```

If either is missing, tell the user:

> "Jira needs an API token and the account email. Export both before continuing:
> ```bash
> export JIRA_TOKEN=your_atlassian_api_token   # id.atlassian.com → Security → API tokens
> export JIRA_EMAIL=you@example.com            # the Atlassian account the token belongs to
> ```
> The same token works for Jira, Jira Product Discovery, and Confluence."

Stop if either is not present.

## Step 4 (Jira): Collect configuration

Ask each question in order, one at a time.

**Host**
> "What's your Atlassian Cloud host? Just the domain, e.g. `acme.atlassian.net`."

**Jira project key**
> "Which Jira project key will hold epics and tickets? (e.g. `PROJ`)"

**GitHub repository**
> "Which GitHub repository does the code live in? (`owner/repo`)"

Ask this even though the tracker is Jira: pull requests always land on GitHub, and `flight-rules pr create` throws before parsing its options when `repo` is absent. Suggest `gh repo view --json nameWithOwner --jq .nameWithOwner` as the default if the user is unsure.

**JPD project key**
> "Which Jira Product Discovery project holds initiatives (Ideas)? (e.g. `DISC`) — hit enter to skip if you're not using JPD yet."

**RFC storage**
> "Where should RFCs be saved — locally in this project's `rfcs/` folder, or in a shared global RFC repository?"

- If local: no follow-up needed.
- If global: ask for the absolute path to the RFC repository.

**Default labels** (optional)
> "Any default labels to apply to every issue created from this project? Hit enter to skip."

**QA lane** (optional)
> "Will this repo use the QA lane (`capture-evidence`, `reproduce-bug`, `verify-ticket`)? If yes, where should the QA recipe live? Hit enter for the default, `.claude/flight-rules.qa.md`."

A relative answer resolves against the config file's directory; an absolute path is used as is. Remember the answer for Step 5 and Step 7.

## Step 5 (Jira): Write the config file

Create `.claude/` if it doesn't exist. Write the config file. Jira identifies *work* by project keys, but `repo` is still required — pull requests land on GitHub whichever tracker holds the tickets.

```markdown
---
tracker: jira
jiraHost: <host>
jiraEmail: <email>
jiraProject: <project key>
jpdProject: <jpd project key>
repo: <owner/repo>
rfcStorage: local
---
```

- Omit `jpdProject` if the user skipped it.
- For global RFC storage, use `rfcStorage: global` and add `rfcStoragePath: <path>` instead of `rfcStorage: local`.
- Add a `defaultLabels` block only if the user provided labels.
- Add `qaRecipe: <path>` only when the user chose a non-default location. The default needs no key.

`JIRA_TOKEN` and `JIRA_EMAIL` stay in the environment — never write them into the config file.

## Step 6 (Jira): Smoke test

Run:

```bash
flight-rules check
```

- If the JSON report shows `"ok": true`: setup is complete. Tell the user:
  > "Setup complete. `flight-rules` is configured for Jira project `<project key>`. Try `/draft-request-for-comments` to author your first RFC."
- If a check fails, show the report and explain by failed check:
  - `credentials` — `JIRA_TOKEN` (or `JIRA_EMAIL`) is not exported in this shell.
  - `reachable` — 401 means the token/email pair is wrong; 404 means the host or project key is wrong; a network error means the host domain is unreachable.
  - `config` — the config file was written incorrectly; show the file and offer to fix it.

---

## Step 7: Scaffold the QA recipe

This step is shared by both branches and does not depend on the tracker. If the user declined the QA lane in Step 4, skip this step.

Run:

```bash
flight-rules qa recipe
```

If it exits non-zero, the recipe is missing. Write the file at the path the message names, using the example from `${CLAUDE_PLUGIN_ROOT}/docs/qa-recipe-format.md`. Replace the `app` and host placeholders with what the user gave you. Leave everything else as placeholders. Then tell the user which sections they must fill in before a capture can run: Login and the credentials.

Then run `git check-ignore -q <path>`. Exit 0 means Git ignores the recipe, so a capture runs against an untracked file. Show the offending rule:

```bash
git check-ignore -v <path>
```

Offer to change a `.claude` rule to `.claude/*` and add `!.claude/flight-rules.qa.md`. Explain in one sentence: a negation cannot re-include a file whose directory is excluded, so the directory rule must become a wildcard.

Re-run `flight-rules qa recipe`. It prints the resolved path.
