# Workflow preflight

Run the environment checks before a workflow changes repository files, git state or tracker state:

```bash
flight-rules check
flight-rules check --workflow execute-work
```

No runtime evidence file is required. The native harness owns permissions and worker scheduling. The check reports what its probes observe; it does not grant access or guarantee that later writes or dispatches will succeed.

The first command reports `scope: "environment"`. Selecting `execute-work`, `execute-wave`, `break-down-work`, `reproduce-bug` or `verify-ticket` adds the relevant environment requirements and reports `scope: "workflow"` and the selected workflow. Both preserve the public `checks`/`ok` shape. Each check retains `name`, `ok`, `detail` and optional `required`; failures can also carry `code` and `remedy`. A check with `required: false` never makes the overall result fail.

## Select the target repository

The session can start in `~/Developer` or another parent directory. Run the check in the repository selected for the task:

```bash
cd ~/Developer/my-repo && flight-rules check --workflow execute-work
```

The tool’s working-directory option is equivalent. The check uses the command’s working directory, not the session’s launch directory. Target the same repository for subsequent tracker, Git and PR commands and worker dispatches. A parent check run in `~/Developer` cannot infer which child repository a later worker will use. Set the directory on each command; no session restart or runtime file is needed.

## What the check establishes

| Observation | Scope and limit |
| --- | --- |
| Config and credentials | Required values are present; secrets are never printed |
| Tracker reachability | Existing GitHub repository/Jira identity read succeeds; tracker writes are not tested |
| GitHub login | Existing `gh auth status` probe succeeds |
| GitHub push entitlement | Existing repository permission query reports account entitlement; no push occurs and transport/branch rules remain untested |
| Git remote read | `git ls-remote origin` succeeds for code workflows; read access does not prove write access |
| Git context | The active checkout is a Git working tree and HEAD resolves to a commit |
| Local write access | Filesystem access checks on the working directory and Git/worktree common metadata; no file or ref is written and harness restrictions still apply |
| QA tools/instructions | Required for QA workflows; existing optional/general-check behavior remains available |

Code workflows are `execute-work` and `execute-wave`. They require GitHub login and push entitlement even with a Jira tracker. Other workflows do not require push entitlement. QA instruction discovery is optional in a general check and required in QA workflows.

Native subprocess probes have a 10-second timeout and a bounded output buffer; tracker ping receives a cancellation signal and the same deadline. Library constructors accept a positive timeout up to 60 seconds. Jira’s bounded ping does not enter rate-limit retry backoff. No probe pushes, creates remote resources, writes a test file or modifies permissions. Services use the invocation’s working directory and environment without changing global process state.

## Native execution

Use the running harness’s named agent tools and respect its permission and scheduling controls. Handle an actual dispatch or operation failure with its cause and remedy. Missing numeric limits or a permission snapshot do not prevent native execution. See [native bindings](./native-orchestration.md) for task identity, report validation and sequential execution when capacity is not exposed.

`AUTHENTICATION` identifies credential/login failures; `MISSING_TOOL` identifies an absent executable. `NETWORK` covers DNS, connectivity and service failures, including connection refusal. It does not identify a sandbox. `PERMISSION_DENIED` records a known operation/account-policy denial; `TIMEOUT` identifies a probe that exceeded its deadline. Unexpected failures remain `UNKNOWN`. Diagnostics redact known credential values, authorization headers, URL credentials and common token parameters.

Unattended reproduction and verification return failed checks or operation errors as named `needs` results without prompting. Existing user authorization remains valid; preflight is not an additional approval requirement. The harness still enforces access when each operation runs.

## Compatibility

The CLI no longer accepts `--runtime-file`. Remove that argument from existing invocations; do not generate a replacement file.

`WorkflowEvidenceSchema`, `WorkflowEvidence`, `ReadinessOptions.evidence` and the readiness service signatures remain available for programmatic consumers. Supplying evidence explicitly opts into the existing caller/worker diagnostics, including scoped context, permissions and dispatch limits. Denied, unknown, malformed or mismatched supplied evidence still fails validation or the applicable checks. Code workflows with explicit evidence also validate its repository root and fixed base instead of using HEAD. Omitting evidence runs environment probes only and makes no assertion about host capabilities.

Native skills do not use this optional SDK diagnostic path. Host adapters that use it supply their own observations in memory; the library cannot authenticate those observations or grant permissions.
