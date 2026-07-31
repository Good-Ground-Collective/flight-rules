# GitHub Review API — `gh` Recipes

The exact commands the code-review skills use to talk to GitHub. Read this file
only when you reach a step that needs GitHub. Everything here runs through the
`gh` CLI, which is already authenticated in the user's environment.

Two skills share this reference and they post **different kinds of review**:

- `guided-code-review` creates a **PENDING** review (§4) that a human submits.
- `autonomous-code-review` submits a **COMMENT** review (§6) with no human in
  the loop.

Sections 1–3 and 5 are common to both.

`gh api` automatically substitutes `{owner}` and `{repo}` for the current
repository, so the literal string `repos/{owner}/{repo}/...` works as-is when
run from inside the repo's checkout.

## 1. Resolve the PR

If the user passed a PR number or URL, use it. Otherwise resolve the PR for the
current branch:

```bash
gh pr view [PR] --json number,title,body,author,baseRefName,headRefName,additions,deletions,changedFiles,url
```

- No `[PR]` argument → `gh pr view` uses the current branch's PR.
- Exit code non-zero or empty → no PR is associated. Ask the user for a PR
  number or URL and retry with it.

## 2. Determine the default branch (for stacked-PR detection)

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
```

Compare against the PR's `baseRefName` from step 1. If they differ, the PR is
**stacked** — it targets another feature branch, not the default branch.

## 3. Fetch the diff

```bash
gh pr diff [PR]
```

For a stacked PR, `gh pr diff` already returns only the diff between the head
and its actual base branch, so it is naturally scoped to the changes unique to
this PR. Use this diff directly; do not diff against the default branch.

To measure size for the too-big guard, count added/removed lines:

```bash
gh pr diff [PR] | grep -cE '^[+-]'
```

If the count exceeds **10000**, stop and ask the author to split the PR.
`autonomous-code-review` handles this case differently — see §6.

## 4. Create the PENDING review

Build a JSON payload and post it. **Omit the `event` field** — that is what
leaves the review in PENDING state, visible only to the author until they
submit it on GitHub.

Write the payload to a temp file, then post it. Replace `<pr-number>` with the
PR number from step 1 — `gh api` substitutes `{owner}` and `{repo}` for the
current repo, but it does **not** fill in the PR number:

```bash
gh api --method POST repos/{owner}/{repo}/pulls/<pr-number>/reviews --input review.json
```

`review.json` shape:

```json
{
  "body": "<the PR explanation + approve-vs-escalate recommendation, Markdown>",
  "comments": [
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "<finding — two-section format>" },
    { "path": "src/bar.ts", "start_line": 10, "line": 14, "side": "RIGHT", "body": "<finding spanning lines 10-14>" }
  ]
}
```

Each comment `body` uses the **two-section format** from the skill: a 1–3 sentence
human-facing summary, followed by a collapsed `<details>` block labeled
`Details For LLM`. Newlines are `\n` inside the JSON string, e.g.:

```json
"body": "`role = \"admin\"` is an assignment, not a comparison, so this always grants admin.\n\n<details>\n<summary>Details For LLM</summary>\n\n`if (role = \"admin\")` assigns then coerces truthy. Use `role === \"admin\"` and add a test asserting `grantAccess(\"user\") === false`, since this gates access.\n</details>"
```

Rules for `comments`:

- `path` is the file path as it appears in the diff.
- `line` is the line number **in the file's new version** (the right side of the
  diff). Use `side: "RIGHT"` for added or unchanged context lines, `side: "LEFT"`
  for a line that was deleted.
- The line **must** be part of the diff hunk. Commenting on a line GitHub does
  not consider part of the diff returns `422 Unprocessable Entity`. Read the
  `@@ -old,+new @@` hunk headers in the diff to pick valid line numbers.
- For a multi-line comment, add `start_line` (and `start_side`); `line` is the
  end of the range.
- An empty `comments` array is valid — a summary-only pending review.

## 5. Handle a rejected comment

If the POST fails with `422` because a comment anchor is invalid, do not drop
the finding. Remove that comment from the `comments` array, append its text to
the `body` with an explicit `path:line` reference, and re-post. Report to the
user which findings were relocated to the summary and why.

**Anchor before you post.** A single bad anchor rejects the whole payload, and a
review with thirty comments is thirty chances to lose the post. Check every
`path:line` against the `@@` hunk headers before the first attempt; retrying is
the fallback, not the plan.

## 6. Submit a COMMENT review

Identical payload to §4 with one added field:

```json
{
  "event": "COMMENT",
  "body": "<the review body>",
  "comments": [ … ]
}
```

`"event": "COMMENT"` submits the review immediately rather than leaving it
pending. It records comments without casting a verdict, and every rule in §4
about `path`, `line`, `side`, and hunk membership applies unchanged.

**`COMMENT` is the only event available on your own PR.** GitHub rejects both
`APPROVE` and `REQUEST_CHANGES` when the reviewer authored the PR, and the
factory pipeline reviews PRs it opened itself. Never send either — a verdict
belongs in the review body as a recommendation, not in the `event` field.

### Too big to review

Where §3 tells an interactive skill to stop and ask, an autonomous run has
nobody to ask. Post a summary-only COMMENT review (empty `comments` array)
stating that the diff exceeded the guard and was not reviewed, carrying an
`ESCALATE` verdict. A silent skip reads as a clean review.
