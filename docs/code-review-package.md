# Shared autonomous review package

The local autonomous-code-review skill and GitHub Actions use one review
method and findings contract. The reviewer reads code and returns a result;
the poster validates that result, checks evidence and human authority, persists
finding state, and applies its own approval policy. A later pass carries the
same finding IDs and conversation forward.

## Consumer entry points

Install an exact version of `@good-ground-collective/flight-rules` from GitHub
Packages. The registry is `https://npm.pkg.github.com`; authentication needs a
token that can read the package, including when a consumer is in another org.
Configure the scope registry and token in the consuming workflow, outside
PR-controlled files. Release CI publishes with its repository GITHUB_TOKEN;
the release job requests packages: write. This PR does not publish a package
or grant cross-repo access until merged/released through that workflow.

The package exports `./review`, `./review/schema` and `./review/transport-schema`.
It also ships the canonical contract, charter and method in docs/.

```js
import {
  reviewContract,
  FileReviewPolicy,
  EvidenceReviewPlanner,
  GitHubReviewVerifier,
  JsonReviewCodec,
} from "@good-ground-collective/flight-rules/review";

const policy = new FileReviewPolicy().load();
const schemas = reviewContract.schemas();
// Feed policy.method, policy.charter, trusted repo rules and schemas.transport
// into one reviewer run. The consumer owns its rubric and model choice.
const result = reviewContract.parse(modelOutput);
const planner = new EvidenceReviewPlanner({
  verifier: new GitHubReviewVerifier({
    repo,
    prNumber,
    prAuthorId,
    owners,
    requireMapping,
    api: {
      get: (path) => client.get(path),
      graphql: (query, variables) => client.graphql(query, variables),
    },
  }),
});
const plan = await planner.plan({
  review: result,
  records: recoveredRecords,
  headSha: currentHead,
});
const codec = new JsonReviewCodec();
// Persist codec.render(record), transition reasons and actual artifact locations.
// Persist codec.state(index) before resolving threads or submitting approval.
```

`reviewContract.parse` performs full variant validation, normalization and
cross-field checks. A transport schema accepts a wider shape and cannot
authorize writes. The generated full JSON Schema validates structural variants;
the contract validator and planner additionally enforce state-dependent rules.
Both JSON artifacts are generated from the same definitions during build.
The consuming model's transport compatibility remains a consuming-adapter
check. Parse/reconcile before any write even if a model reports a valid result.

`GitHubReviewVerifier` uses gh by default, or the action's GitHub client adapter.
It checks artifact provenance, current-head code/CI evidence and eligible
humans. It does not decide whether a reply answers a question; the reviewer
does that and must give a reason. The default adapter rejects local command
verification because it has no trusted executor. A consumer with a trusted
executor can implement the ReviewVerifier interface. ValidatedReviewVerifier
is for already verified adapter attestations; never populate it from model
output or PR text.

Document references are structurally HTTPS URLs. The reviewer must actually
read their content. A consumer that cannot supply a source retains the finding
and reports the limitation; an unread link is not resolution evidence.

## Repository context

`FileReviewPolicy.repository({ cwd, trustedRef, contextPath })` reads the
configured CODE-REVIEW.md path and root AGENTS.md/CLAUDE.md from a pinned
trusted commit. It also supplies candidate CODEOWNERS files. Apply GitHub's
CODEOWNERS precedence when selecting an authority mapping; merely loading a
file does not grant authority. Explicit login mappings may be supplied through
trusted action configuration. Missing rules are recorded and symlinks refused.
PR-head rule changes are part of the review, not instructions for that review.

## Durable state and approval

`JsonReviewCodec` emits full record markers and a summary index. Accept markers
only from configured trusted reviewer IDs attached to this PR. Recover every
indexed record plus orphan markers from partial posts; records in review bodies
have the same lifecycle as inline comments. Fingerprints help deduplicate;
they cannot replace IDs. Missing records, unsupported versions, invalid
transitions and failed state writes cannot clear blockers.

The planner generates IDs for genuinely new findings. Retry posting the same
persisted plan or recover its existing records; do not re-plan new IDs after
a partial post. The consumer detects semantic duplicates before posting and
keeps reasons/previous record versions in transition history. The consumer
rechecks the head before writes and maintains per-PR serialization.

Persist records and the summary first. If a write fails, report INCOMPLETE and
reconcile before retrying. Only accepted resolved/withdrawn transitions close
threads. Approval, if enabled by a consumer and allowed by current required CI
and its separate risk gate, is the final write. The local skill posts COMMENT.

tlp-actions keeps its Tier 1 High pilot hold separate from the core outcome.
It owns prompt assembly, CI/bot triggers, posting/chunking, human-readable
summary shortening, and its remediation round cap. The action and local skill
must not run two independent reviewers and merge their opinions.
