# GitHub Review API — `gh` Recipes

The exact commands the guided-code-review skill uses to talk to GitHub. Read
this file only when you reach a step that needs GitHub. Everything here runs
through the `gh` CLI, which is already authenticated in the user's environment.

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
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "<finding>" },
    { "path": "src/bar.ts", "start_line": 10, "line": 14, "side": "RIGHT", "body": "<finding spanning lines 10-14>" }
  ]
}
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

## Caveat: reviewing your own PR

GitHub forbids **approving** your own PR, but a PENDING review carrying only
comments on your own PR is allowed. Since this skill never submits an approve
event, self-review during testing works. The human still submits the verdict.
