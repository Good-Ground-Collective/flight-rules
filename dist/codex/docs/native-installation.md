# Native installation and configuration

The native packages contain the same shared skills and resolved worker prompts. Host installation and settings are separate from workflow permission evidence. E6's SDK/MCP adapters are not required to use these native packages.

## Select the configuration host

The CLI inside `dist/claude` or `dist/codex` reads its generated `flight-rules-install.json` to select its host. This works after relocation and when invoking `bin/flight-rules.mjs` directly. `FLIGHT_RULES_HOST=claude|codex` overrides that selection; library callers can supply `createFlightRules({ host })` with highest priority. An explicit `hostSettings` adapter still owns its settings layers.

The generic npm CLI keeps the historical Claude default. For Codex, export `FLIGHT_RULES_HOST=codex` in the invoking shell or use the Codex package's CLI. `flight-rules config show` reports `host`, all layer paths and each value's source. An unknown host is an error, never a fallback. `FLIGHT_RULES_HOME`, when used, names the installation root containing docs and native metadata.

| Scope | Claude | Codex (flight-rules-owned JSON) |
| --- | --- | --- |
| user | `$CLAUDE_CONFIG_DIR/settings.json`, otherwise `~/.claude/settings.json` | `~/.agents/flight-rules.settings.json` |
| project | `.claude/settings.json` | `.agents/flight-rules.settings.json` |
| local | `.claude/settings.local.json` | `.agents/flight-rules.settings.local.json` |
| file | Existing config selected by `flight-rules config path` | Same legacy compatibility and explicit override |

Precedence remains user → project → local → file. Claude uses `pluginConfigs["flight-rules@flight-rules"].options`; Codex's neutral files hold the values directly. The CLI does not invent settings in Codex's native `config.toml`. Keep machine-local settings untracked. Credentials stay in the environment.

Linked worktrees fall back to the main checkout for absent local/file layers. Existing legacy files retain their precedence, including a legacy file created under the other host. A new Codex file layer defaults to `.agents/flight-rules.local.md`. Use `config set/unset --scope` for changes. Migration is explicit: preserve the original, compare all values and sources, and remove it only after the user has authorized that migration.

## Claude Code

Use the native marketplace commands to add `Good-Ground-Collective/flight-rules`, then install `flight-rules@flight-rules`. The marketplace points to `dist/claude`. Inspect `claude plugin list` for the installed path. Confirm agent discovery through the running host’s registry. On the inspected version, `plugin details` reports zero agents despite successful runtime discovery; the native installation proof checks the initialization registry directly.

Put that plugin's `bin` directory on PATH or invoke its `bin/flight-rules` by absolute path. Claude discovers the plugin's agents through its manifest. There is no separate copy into project agents. For a local development checkout, `--plugin-dir <absolute-dist/claude>` is a separate development loading path, not proof that a marketplace install succeeded.

## Codex

Add the marketplace with `codex plugin marketplace add Good-Ground-Collective/flight-rules`. On the inspected CLI, install with `codex plugin add flight-rules@flight-rules --json`; use `/plugins` or the desktop plugin directory where that is the available installation surface. See the [official plugin installation guidance](https://learn.chatgpt.com/docs/plugins) and [marketplace authoring guidance](https://developers.openai.com/plugins/build/plugins). Inspect the native install result for the actual cache path and put its `bin` directory on PATH.

The generated `flight-rules-install.json` includes each resolved neutral `registration` and the native file checksum. Once native discovery is confirmed, use that metadata in E4 readiness evidence; observe permissions and limits separately.

The plugin loads skills; the emitted standalone custom-agent files require a registration step. From the installed Codex plugin's CLI, run:

```sh
flight-rules agents status --scope project
flight-rules agents install --scope project
```

Run in the repository root. Project registrations go to `.codex/agents`; `--scope user` instead uses `$CODEX_HOME/agents`, defaulting to `~/.codex/agents`. These are Codex's [documented custom-agent locations](https://learn.chatgpt.com/docs/agent-configuration/subagents). The full npm package can install its bundled Codex registrations too.

Installation copies missing definitions and accepts identical files. It checks every expected definition before writing, refuses differing existing files and symlinks inside the installation paths, and leaves unrelated definitions/settings intact. To upgrade a differing definition, compare it with the new package, back up the old file, and explicitly remove it before reinstalling. There is no overwrite or permission-widening flag. Reload a trusted native session after installation; project trust and managed configuration remain host decisions.

`agents status` returns `evidence: "files-only"`. Confirm actual native discovery in the fresh host, then supply observed registration and permission evidence to `flight-rules check --workflow ... --runtime-file ...` as described in [workflow-preflight](./workflow-preflight.md). A successful copy cannot establish model availability, dispatch access, occupancy, or network permission.

## Evidence boundaries

Implementation targets inspected here: Codex CLI 0.162.1 and Claude Code 2.1.296. Recheck native commands when versions differ. Deterministic tests cover host selection, source integrity, repeat installation, conflicts, settings precedence and worktree fallback. Native discovery and the full model-driven RFC → breakdown → implementation proof are recorded separately; the latter belongs to E5's workflow proof ticket #250.

Run `npm run test:installation:native` with both native clients installed. The script installs local marketplace copies into temporary host configuration directories, checks Claude's initialization registry, checks Codex's installed skill registry, and tests each Codex role with a malformed negative control before restoring it. It sends no model turns. Temporary evidence remains at the reported scratch path for inspection; remove that directory when finished.

The [2026-10-13 discovery result](./evidence/native-installation-2026-10-13.json) observed all 13 skills and seven named registrations on both clients. The assembled development artifact retained version 1.76.0; CLI and registration-manifest SHA-256 values identify the exact tested bytes. This is installation/discovery proof, not the full workflow execution proof.
