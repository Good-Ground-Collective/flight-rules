# QA Recipe — Format and Example

The per-repo file that carries everything product-specific a capture needs:
hosts, login selectors, the token recipe, data-setup calls, and traps. It lets
`capture-evidence`, `reproduce-bug`, and `verify-ticket` stay generic — the
skills read this file for the facts and `evidence-capture.md` for the protocol.
One recipe per app repo, committed beside the code it describes, found through
`flight-rules qa recipe`. A skill references it by the path that command prints.

## 1. Where it lives

The recipe defaults to `.claude/flight-rules.qa.md`, beside the config file.
Set `qaRecipe:` in `.claude/flight-rules.local.md` to override the path. A
relative override resolves against the config file's directory; an absolute
override is used as is. `flight-rules qa recipe` prints the resolved path and
exits non-zero when the file is missing.

The default sits under `.claude/`, which repos commonly gitignore as a whole
directory. Git cannot re-include a file whose parent directory is excluded, so a
plain `.claude` ignore rule swallows the recipe. Change the rule to `.claude/*`
and add `!.claude/flight-rules.qa.md`. The wildcard form still ignores the
directory's contents but leaves the directory included, which the re-include
requires.

## 2. Frontmatter fields

The structured facts live in YAML frontmatter:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `app` | string | yes | The web-client repo this recipe drives |
| `api` | string | no | The API repo behind it, for root-causing |
| `environments` | map | yes | Named environments, each with `appUrl` and `apiUrl` |
| `defaultEnvironment` | string | yes | The environment a capture uses when the caller names none |
| `viewport` | string | no | `WxH`; defaults to `1920x1080` |
| `credentials` | map | yes | `username`, `password`, optional `totp`; each an `op://` reference or the literal name of an environment variable to read |

The CLI does not parse this frontmatter. A skill reads the whole file, so the
YAML may nest here — and only here. The one CLI-parsed key, `qaRecipe:`, stays
flat in `flight-rules.local.md`.

## 3. Sections

Markdown headings carry the prose a skill reads. Each section does one job:

- `## Login` names the entry URL, the field selectors, the submit selector, and
  what "logged in" looks like — an element the skill can `find`.
- `## Token mint` shows how to obtain an API token from the logged-in page, as an
  `eval` snippet, for when the API is needed for same-layer confirmation or data
  setup.
- `## Data setup` lists the REST calls that create the state a capture needs,
  each with its required headers and its cleanup call.
- `## Traps` lists the product rules that make a capture look right but be wrong.
- `## Repo map` names the repos and where the code for common surfaces lives, for
  root-causing.
- `## Visible surfaces` maps a backend change to the page that shows its effect,
  so `execute-work` can decide whether an API-only change has something to
  screenshot.

## 4. Credential rules

A credential value is never a secret. It is either an `op://vault/item/field`
reference or the bare name of an environment variable to read. The capture skill
resolves the three it knows into `FLIGHT_RULES_QA_USERNAME`,
`FLIGHT_RULES_QA_PASSWORD`, and `FLIGHT_RULES_QA_TOTP_SECRET`. Headless
1Password needs `OP_SERVICE_ACCOUNT_TOKEN` in the environment.

## 5. Example

A complete recipe. Every host, vault, and item name is a placeholder.

````markdown
---
app: acme-web
api: acme-api
environments:
  staging:
    appUrl: https://app.staging.acme.example
    apiUrl: https://api.staging.acme.example/v1
defaultEnvironment: staging
viewport: 1920x1080
credentials:
  username: op://qa-staging/acme-web-auditor/username
  password: op://qa-staging/acme-web-auditor/password
---

## Login

Open `appUrl`. The form is email-first: fill `input[name=loginId]`, click the
continue button, then fill `input[type=password]`, check `#rememberDevice`, and
click `#submit-button`. Logged in when `find "Dashboard"` returns a node. A fresh
browser context carries no single sign-on, so expect the form every time.

## Token mint

The access token is held in memory, not storage. Mint it inside one `eval`:

```js
fetch('/v1/auth/refresh', {
  method: 'POST',
  credentials: 'include',
  headers: { 'x-client-kind': 'web' },
  body: '{}',
}).then(r => r.json()).then(j => j.data.access_token)
```

Run the whole API workflow inside that same `eval` so the token never leaves the
page.

## Data setup

To create a submitted audit: `POST /v1/audit-templates`, `POST …/sections`,
`POST …/sections/:sid/questions`, `PATCH` a non-empty `description`, then
`POST …/:id/publish`; next `POST /v1/audits`; then `POST /v1/audits/:id/submit`
with header `Idempotency-Key: <uuid>`. Clean up with `DELETE /v1/audits/:id`.
Templates have no API delete, so name throwaway templates clearly.

## Traps

- Publish returns 422 unless the template has a non-empty description and a
  category.
- Audits create only from a published template.
- A rating question can never fail; build a pass/fail capture from a pass/fail
  question.
- Submit without `Idempotency-Key` returns 400.

## Repo map

Web client is `acme-web`; API is `acme-api`. Scorecard rendering lives under
`src/scorecard/` in the client; scoring rules under `src/audits/scoring/` in the
API.

## Visible surfaces

- Scoring or audit API changes: the scorecard page for a completed audit.
- Template API changes: the template builder at `/audit-catalog/templates/:id`.
- Auth changes: the login form and the first page after login.
````
