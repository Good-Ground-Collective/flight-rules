---
name: setup
description: "First-run setup for the flight-rules plugin. Writes the flight-rules config — shared values to the user's Claude Code settings, per-project values to the project — and verifies the environment is ready to use."
---

# Setup

This skill writes the flight-rules configuration and verifies your environment is ready. It takes about two minutes the first time, and less in every later repository, because shared values only need setting once.

## Where config lives

The CLI merges config key by key from four layers, lowest precedence first:

| Scope | File | Use it for |
| --- | --- | --- |
| `user` | `~/.claude/settings.json` | Values shared by every project: `tracker`, `jiraHost`, `jiraEmail`, `jiraProject`, `jpdProject`, `confluenceSpaceKey`, the status names, `rfcStorage`/`rfcStoragePath`, `defaultLabels` |
| `project` | `.claude/settings.json` | Per-project values the team shares through git, such as `repo` |
| `local` | `.claude/settings.local.json` | Per-project values for this machine only |
| `file` | `$FLIGHT_RULES_CONFIG`, else `.claude/flight-rules.local.md` | The older config file; still read, and it outranks the settings files |

In the settings files the values sit under `pluginConfigs["flight-rules@flight-rules"].options`. Never edit any of these files by hand. Write each value with `flight-rules config set <key> <value…> --scope <scope>`; array keys such as `defaultLabels` take several values.

## Step 0: Read what is already configured

Run:

```bash
flight-rules config show
```

It prints the merged `values`, the scope each came from (`sources`), and whether they form a complete config (`valid`, with `error` naming what is missing). Show the user the current values and their scopes. Ask whether to reconfigure or only fill the gaps. When user-scope settings already cover the tracker, skip every question below whose answer is already there; a new repository usually needs only `repo`. When `values` is empty, nothing is configured yet; continue from Step 1.

When writing, offer the scope from the table above as the default for each key, and let the user override it. When a `flight-rules.local.md` already exists, offer to move its values into settings: `config set` each one in its new scope, then delete the file once `config show` reports every key from the new scope.

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

## Step 5 (GitHub): Write the config

Write each answer with `flight-rules config set`, using the scopes from **Where config lives**:

```bash
flight-rules config set tracker github --scope user
flight-rules config set rfcStorage <local|global> --scope user
flight-rules config set rfcStoragePath <path> --scope user        # global storage only
flight-rules config set defaultLabels <label1> <label2> --scope user   # only if given
flight-rules config set repo <owner/repo> --scope project
```

Skip any key Step 0 showed is already set to the right value. Add `qaRecipe` with `--scope project` only when the user chose a non-default location; the default needs no key.

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

Jira, Jira Product Discovery, and Confluence all authenticate with one Atlassian API token plus the account email (HTTP Basic auth).

The CLI reads the token from the first of these that is set: `JIRA_TOKEN`, `JIRA_API_TOKEN`, `JIRA_API_KEY`. Any one is enough. Do not ask the user to rename or re-export a token they already have under another of these names. Run:

```bash
for v in JIRA_TOKEN JIRA_API_TOKEN JIRA_API_KEY; do printenv "$v" >/dev/null && echo "token: $v"; done; echo "email: ${JIRA_EMAIL:+set}"
```

If no `token:` line prints, tell the user:

> "Jira needs an Atlassian API token (id.atlassian.com → Security → API tokens). Export it under any one of `JIRA_TOKEN`, `JIRA_API_TOKEN`, or `JIRA_API_KEY`, for example:
> ```bash
> export JIRA_TOKEN=your_atlassian_api_token
> ```
> The same token works for Jira, Jira Product Discovery, and Confluence."

Stop if no token is present.

The email does not need to be exported. Step 4 asks for it and writes it to the config as `jiraEmail`. When `JIRA_EMAIL` is set, it overrides the config value, so offer it as the default answer in Step 4.

## Step 4 (Jira): Collect configuration

Ask each question in order, one at a time.

**Host**
> "What's your Atlassian Cloud host? Just the domain, e.g. `acme.atlassian.net`."

**Atlassian email**
> "Which Atlassian account email does the API token belong to?"

Offer `$JIRA_EMAIL` as the default when it is set.

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

## Step 5 (Jira): Write the config

Jira identifies *work* by project keys, but `repo` is still required, because pull requests land on GitHub whichever tracker holds the tickets. Write each answer with `flight-rules config set`, using the scopes from **Where config lives**:

```bash
flight-rules config set tracker jira --scope user
flight-rules config set jiraHost <host> --scope user
flight-rules config set jiraEmail <email> --scope user
flight-rules config set jiraProject <project key> --scope user
flight-rules config set jpdProject <jpd project key> --scope user   # only if given
flight-rules config set rfcStorage <local|global> --scope user
flight-rules config set rfcStoragePath <path> --scope user          # global storage only
flight-rules config set repo <owner/repo> --scope project
```

- Skip any key Step 0 showed is already set to the right value.
- If this repository uses a different Jira project from the user's other repositories, write `jiraProject` with `--scope project` instead.
- Add `defaultLabels` only if the user provided labels, and `qaRecipe` (with `--scope project`) only for a non-default location.

The API token stays in the environment. Never write a token into any config file.

## Step 6 (Jira): Smoke test

Run:

```bash
flight-rules check
```

- If the JSON report shows `"ok": true`: setup is complete. Tell the user:
  > "Setup complete. `flight-rules` is configured for Jira project `<project key>`. Try `/draft-request-for-comments` to author your first RFC."
- If a check fails, show the report and explain by failed check:
  - `credentials` — the detail names what is missing: no token under `JIRA_TOKEN`, `JIRA_API_TOKEN`, or `JIRA_API_KEY`, or no email in either `JIRA_EMAIL` or the config's `jiraEmail`.
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
