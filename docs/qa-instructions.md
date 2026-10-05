# QA Instructions — Discovery and Content

QA instructions are freeform markdown that tell an agent how to verify work in a
repo: what to run, where to point it, how to get access, and what to watch out
for. They let `capture-evidence`, `reproduce-bug`, `verify-ticket`, and the
`qa-engineer` agent stay generic. The skills read the instructions for the facts
and `evidence-capture.md` for the capture protocol.

One repo can hold several sets of QA instructions: one at the root and one per
subproject that verifies differently. Commit them beside the code they describe.

## 1. Where they live

At each directory level, the first of these that exists and is not empty wins:

1. A `QA` section in `AGENTS.md`. The section is the heading whose text is
   exactly `QA` (any case, any level), down to the next heading of the same or a
   higher level. Deeper subheadings stay inside the section.
2. `QA.md` in that directory.
3. `.agents/QA.md` in that directory.

Discovery starts at a directory and walks up to the git repository root, taking
one source per level. Sources come back nearest first. A subproject's
instructions are more specific than the root's, so a skill reads them first and
uses the root's for anything they leave out.

```bash
flight-rules qa instructions --from packages/api
```

The command prints JSON and always exits 0:

```json
{
  "found": true,
  "sources": [
    { "path": "/repo/packages/api/QA.md", "kind": "qa-md", "dir": "/repo/packages/api", "content": "..." },
    { "path": "/repo/AGENTS.md", "kind": "agents-md-section", "dir": "/repo", "content": "..." }
  ]
}
```

`kind` is one of `agents-md-section`, `qa-md`, `agents-dir-qa-md`, or
`legacy-recipe`. `--from` defaults to the working directory, and accepts a file
path. A skill passes the directory of the code the ticket changed when it knows
it.

When no source exists at any level, the command falls back to the old QA recipe
(`qaRecipe` in the config, or `flight-rules.qa.md` beside it). That
source carries `"legacy": true` and a `hint` to move it into a `QA.md`. The
fallback will be removed in a later release.

`flight-rules qa recipe` still prints the path of the nearest source, for older
skill copies. It is deprecated.

## 2. What to write

The content is freeform. Write it for an agent that has never seen the repo and
cannot ask questions mid-run. None of these topics is required. Cover the ones
that apply:

- **Kinds of verification.** Which ways of checking work exist here: a web UI, a
  REST API, a Salesforce org, an AWS account, a CLI, a mobile build. Say which
  one fits which kind of change.
- **Environments.** Each environment's name and URLs, and which one to use by
  default.
- **Access and credentials.** Where each credential comes from: an environment
  variable to read, a secrets-manager item to resolve, or a thing a human must
  supply. Name the variable or the item. Never write a secret into the file.
- **Auth workarounds.** How to get past single sign-on (SSO), multi-factor
  prompts, or IP allow-lists in a headless browser.
- **Login.** The entry URL, the field and submit selectors, and the element that
  proves the login worked.
- **Helpers.** Scripts, make targets, or seed commands that set up state.
- **Data setup and cleanup.** The calls that create the state a check needs, and
  the calls that remove it.
- **Traps.** Product rules that make a check look right when it is wrong.
- **Visible surfaces.** For a backend change, the page or output that shows its
  effect, so `execute-work` knows what to screenshot.
- **Repo map.** Where the code for common surfaces lives, for root-causing.

### Credentials a human must supply

The QA skills never prompt. When the instructions say a credential or access
must come from a human, and the environment does not already provide it, the
skill stops with one line beginning `needs:` that names exactly what to provide
and where. Write the instructions so that line can be specific: name the
variable to export, or the access to grant.

When the instructions say to resolve a secret through a manager such as
1Password (`op run --env-file=...`), the take runs inside that command. No skill
pre-checks the manager's sign-in state.

## 3. Examples

Every host, vault, and item name below is a placeholder.

### A web app behind SSO

````markdown
## QA

Verify UI changes in the browser against staging, `https://admin.staging.acme.example`.
API changes can be checked directly at `https://api.staging.acme.example/v1`.

### Access

Staging uses Microsoft SSO, which a headless browser cannot complete. Use the
local password login instead: open `/login?local=1`, fill `#email` and
`#password`, submit with `button[type=submit]`. Logged in when `find "Tenants"`
returns a node.

Credentials: `ACME_QA_EMAIL` and `ACME_QA_PASSWORD` from the environment. If
either is unset, a human must export them; the account is "QA admin (staging)"
in the team vault.

### Traps

- The tenant list caches for 30 seconds; reload before asserting a new tenant.

### Visible surfaces

- Tenant API changes: the tenant detail page at `/tenants/:id`.
````

### An AWS backend wired to a Salesforce org

````markdown
# QA

There is no web client. Verify through the Salesforce org and the AWS staging
account.

## Salesforce

Use a scratch org for full tests: `npm run org:create -- --alias qa` creates one
with the package and sample data. A human must have authorized the Dev Hub
(`sf org list` shows it); if not, stop and ask for Dev Hub access.

Point the org at staging with `npm run org:wire -- --env staging`.

## AWS

Staging is account `000000000000`. Use the `acme-staging` profile
(`AWS_PROFILE=acme-staging`); if `aws sts get-caller-identity` fails, a human
must run `aws sso login --profile acme-staging`.

Watch processing in the `acme-staging-ingest` log group. A record is processed
when a `matched` line with its id appears.

## Traps

- The ingest queue retries for 15 minutes; a failure is not final until then.
````

### An API-only service

````markdown
## QA

API only. Run the service locally with `docker compose up api`, then call
`http://localhost:8080`. `scripts/token.sh` prints a bearer token for the seed
user; no human input is needed.

Seed data: `npm run seed`. Clean up with `npm run seed:reset`.

There is no visible surface. Evidence is the request and response, saved as text.
````
