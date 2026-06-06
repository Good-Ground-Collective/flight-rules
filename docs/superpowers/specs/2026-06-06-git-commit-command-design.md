# flight-rules git commit command — Design Spec

**Date:** 2026-06-06
**Status:** Approved

---

## Overview

Adds a `flight-rules git commit` subcommand that stages files, constructs a conventional commit message, and appends auto-generated attribution footers identifying the plugin version, harness version, and model used. This replaces the generic `Co-Authored-By: Claude` trailer with tooling-specific attribution.

This spec also covers the release infrastructure rework: removing the manual binary commit requirement, replacing it with an automated release pipeline that rebuilds and commits the binary after version bumps.

---

## Section 1: Command Surface

```
flight-rules git commit \
  --file src/commands/git.ts \
  --file src/index.ts \
  --type feat \
  --scope git \
  --description "add git commit command" \
  [--body "longer prose explanation"] \
  [--footer "Reviewed-By: alice"] \
  [--model claude-sonnet-4-6]
```

- `--file` — repeated flag; each value is a path to stage. Agents should pass small, focused sets of files consistent with the project ethos of small commits.
- `--type`, `--scope`, `--description` — conventional commit components. All three are required; missing any one exits with code 1.
- `--body` — optional multi-line body (single `--body` flag value).
- `--footer` — repeated flag for any caller-supplied trailers.
- `--model` — optional; omitted from the commit if not provided.

**Constructed commit message format:**

```
<type>(<scope>): <description>

<body>                            ← omitted if --body not provided

<caller footers>                  ← omitted if no --footer flags
Flight-Rules-Version: <version>
Harness-Version: <harness>@<harness-version>
Model-Used: <model>               ← omitted if --model not provided
```

**Output:** JSON to stdout — `{ "sha": "abc123", "message": "feat(git): ..." }`. Non-zero exit on failure with error message to stderr.

**Auto-generated footers (always last, in this order):**

| Footer | Source |
|---|---|
| `Flight-Rules-Version: 0.9.1` | Read from `package.json` at runtime via path relative to `process.argv[1]` |
| `Harness-Version: claude-code@2.1.165` | Parsed from `AI_AGENT` env var (`claude-code_2-1-165_agent` → `claude-code@2.1.165`) |
| `Model-Used: claude-sonnet-4-6` | `--model` flag; omitted if not provided |

---

## Section 2: Architecture

### New files

```
src/git/
  executor.ts          # GitExecutor interface + NodeGitExecutor implementation
  executor.test.ts     # Unit tests with MockGitExecutor
src/commands/
  git.ts               # runGitCommand → routes to runGitCommitCommand
  git.test.ts          # Tests with MockGitExecutor injected
src/
  parse-flags.ts       # Shared flag parser, upgraded for repeated keys
  parse-flags.test.ts  # Tests for multi-value flag parsing
```

### `GitExecutor` interface

```typescript
interface GitExecutor {
  stage(files: string[]): Promise<void>
  commit(message: string): Promise<void>
  getCommitSha(): Promise<string>
}
```

`NodeGitExecutor` implements this using `child_process.execFile` (promisified). It only ever calls `git` as the executable — no shell string interpolation — so file paths with special characters cannot cause injection.

### `parseFlags` upgrade

The existing `parseFlags` function is duplicated across `epic.ts`, `ticket.ts`, and `tdd.ts`. Extract it to `src/parse-flags.ts` and upgrade the return type to `Record<string, string | string[]>` — single-occurrence flags remain strings; repeated flags become string arrays. Update all existing command files to import from the shared utility.

### `src/index.ts` routing

The `git` command bypasses `buildTracker()` — it needs no task tracker config. This also fixes a latent bug where commands without a tracker context would fail if no `.claude/flight-rules.local.md` config file exists.

```typescript
if (command === 'git') { await runGitCommand(rest, new NodeGitExecutor()); return }
```

---

## Section 3: Release Infrastructure

### CI workflow changes (`.github/workflows/ci.yml`)

**Remove:** The `Build freshness` step (`npm run build && git diff --exit-code bin/`). Developers no longer commit the binary manually.

**Add:** A `release` job that runs only on push to `main`, sequenced after `ci` passes:

```yaml
release:
  needs: ci
  runs-on: ubuntu-latest
  permissions:
    contents: write
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc
        cache: npm
    - run: npm ci
    - run: npx semantic-release
    - run: npm run build
    - name: Commit binary
      run: |
        git config user.name "github-actions[bot]"
        git config user.email "github-actions[bot]@users.noreply.github.com"
        git add bin/flight-rules
        git diff --cached --quiet || git commit -m "chore: rebuild binary for release [skip ci]"
        git push
```

`contents: write` on the job grants the built-in `GITHUB_TOKEN` push access — no external secrets required.

### Plugin manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "flight-rules",
  "version": "0.1.0",
  "description": "PM-to-engineering pipeline for Good Ground Collective",
  "repository": "https://github.com/good-ground-collective/flight-rules",
  "skills": "./skills/",
  "agents": "./agents/"
}
```

### `package.json` additions

Add a `semantic-release` configuration block and a `release` script:

```json
"scripts": {
  "release": "semantic-release"
},
"release": {
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

Add `semantic-release` and its plugins as devDependencies.

---

## Section 4: Testing

- `parse-flags.test.ts` — verify single-value flags return strings, repeated flags return arrays, mixed usage works correctly
- `executor.test.ts` — verify `NodeGitExecutor` calls `execFile` with correct `git` arguments; mock `child_process.execFile`
- `git.test.ts` — verify `runGitCommitCommand` constructs the correct commit message (with and without `--body`, `--footer`, `--model`), calls `executor.stage` then `executor.commit` in order, outputs correct JSON; verify exits with code 1 when `--type`, `--scope`, or `--description` is missing
- `AI_AGENT` parsing — covered in `git.test.ts` via `vi.stubEnv`

---

## Open Questions

1. **`semantic-release` + binary commit ordering** — the release job above runs semantic-release (version bump + tag) then rebuilds. If semantic-release pushes a tag before the binary commit, the binary commit lands after the tag. A future improvement would be a custom semantic-release plugin that runs the build as part of the release lifecycle. Acceptable for now.
2. **Plugin install syntax for private repos** — carried over from the original spec; unresolved and out of scope for this plan.
