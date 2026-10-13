# Installed workflow proof

This proof runs the shared RFC, breakdown, and execution skills in real native host sessions against a synthetic greeting CLI. Native tool events and worker reports are execution evidence; a fixture expectation or a passing policy unit test is not. The proof is opt-in because it uses model turns and writes tickets and PRs in disposable private repositories.

## Reproduce the setup

Use Node 24 and authenticated Claude Code, Codex, and GitHub CLI installations. Run `npm run test:installation:native` and keep its reported scratch directory. Its `report.json` identifies the installed cache paths and the artifact hashes. The native discovery script does not send model turns.

Create separate `workflow-claude` and `workflow-codex` Git repositories inside that scratch directory, with private GitHub repositories named `Good-Ground-Collective/flight-rules-e5-proof-<unique-suffix>`. Seed a README, `.gitignore`, `package.json`, lockfile, and a clearly attributed synthetic RFC input. Ignore `node_modules/`, `.proof/`, `.claude/`, `.codex/`, and `.agents/`. Configure each repository through its installed `flight-rules config set --scope project` commands: GitHub tracker, its own repository, local RFC storage, and the existing in-progress/in-review labels. Disable Ariadne only in the test repository's local configuration. Install Zod with lifecycle scripts disabled. Commit and push the baseline before any workflow begins.

Install Codex registrations in `workflow-codex` using the installed CLI's `agents install --scope project`. In the isolated Codex home's `config.toml`, trust that exact operator-created directory:

```toml
[projects."/absolute/scratch/workflow-codex"]
trust_level = "trusted"

[agents]
enabled = true
max_concurrent_threads_per_session = 2
```

The installation probe's repository is a different directory. Trusting that probe does not trust the workflow checkout. `agents status` establishes file integrity only. The live parent must see a named role selector in its spawn tool before declaring dispatch available. A `task_name` label alone cannot select a registration. In this proof the missing trust entry produced a real `DISPATCH_UNAVAILABLE` stop before any ticket was created; trusting only the intended scratch checkout exposed the installed selector.

Claude model turns use the isolated installed plugin via `--plugin-dir`, project/local settings, disabled hooks and memory, and the existing native login. They do not use the isolated install directory as an authenticated Claude home. Codex uses the isolated home and a temporary mode-0600 login copy, which the runner removes on completion. Neither path changes normal user plugin settings.

## Run and retain each stage

Write an explicit operator prompt for each stage, then run:

```sh
node scripts/run-native-workflow-stage.mjs \
  --root /absolute/scratch \
  --host claude \
  --stage rfc-question \
  --prompt /absolute/rfc-question.txt \
  --read-only
```

Repeat for `--host codex`. Resume with `--session <native-session-id>` from the recorded native startup event, and use a new `--stage` name for every turn. Omitting `--read-only` enables the scoped test invocation's write path. Codex retains the workspace sandbox and automatic approval review; denied Git metadata writes must use that normal approval path. Claude uses explicit tool permissions with `dontAsk`, and an operation outside those permissions must stop rather than switch to bypass mode.

The runner records the actual command, client version, artifact hashes, starting commit, prompt hash, JSONL events, stderr, and process result. It refuses to overwrite stage evidence. Each model stage is bounded to at most ten minutes; its preceding client/Git inspections each have a ten-second timeout; Claude additionally has a $12 maximum and a turn limit. Codex has a wall-time bound, not a dollar cap. Raw logs remain local; publish only inspected, sanitized evidence with credentials and machine paths removed. A timeout or process exit does not count as workflow success.

The model must read the installed skill and perform its own calls. Operator setup supplies repositories and known permissions, not invented worker results. Use an explicit conservative policy of one outstanding worker and one child layer only after the parent observes named dispatch and its actual occupancy. Save context, dispatch identity, native handle, original request, and returned report separately. Keep earlier failed checks when later setup resolves them.

## Required observations

1. Leave missing-name behavior unresolved in the initial synthetic RFC. Have both hosts ask and stop without changing the repository. Wait for a real human answer. Preserve that wording separately from any operator interpretation; the runner cannot supply a default or manufacture approval. Resume both native sessions with the actual reply.
2. Finish the RFC stage through the installed skill. Inspect and merge the RFC-only PR under existing human authorization before invoking breakdown. The fixture remains explicitly synthetic; only the actual answer is attributed to the human.
3. During breakdown, deliberately deny `tracker.write` in the invocation policy. Record the real failing readiness command and before/after repository and tracker observations. This tests policy handling, not an OS sandbox or invalid credentials. Remove that deliberate denial only for the separately authorized positive phase, collect fresh observations, and require readiness to pass.
4. Dispatch separate implementation and testing research briefs through the installed `research-agent`, within the observed capacity. Retain both real reports. Create one portable layered-body ticket through the flight-rules CLI after the authorized preview. Do not replace missing research with inline work.
5. Invoke execution on that ticket. Pause after the first implementation report and before independent verification. Record the original acceptance criteria and the union of changed paths. Retain proof that the first implementation's tests passed.
6. Inject a controlled output defect into the scratch CLI and record before/after hashes plus a failing test. Resume at the verifier gate. Give the verifier only original criteria and changed paths, without the implementer's rationale or the explanation of the injection. Require a real FAIL, a directed implementation retry, and a separate PASS before opening the implementation PR.
7. Inspect the final tree, tests, dispatch reports, and PR. Preserve any unproved boundary in the result. Archive the disposable repositories when no further runs need them; remove scratch directories and local raw logs only after the reviewed evidence has been retained.

The real human's answer in this run was “oh, uh I guess it can print white space”. The operator stated the implementation interpretation back to the human: one newline on stdout and exit zero for a missing or whitespace-only name. The precise newline and exit status are operator-selected fixture mechanics, not a verbatim human requirement.

## Recorded execution: 2026-10-13

The [sanitized execution record](./evidence/native-workflow-2026-10-13.json) contains the original synthetic RFC, actual human answer, invocation prompts, installed artifact hashes, readiness failures, paired worker requests/results, native dispatch options, and operator fault-injection test results. Machine paths are replaced with `<scratch>` and `<home>`. Raw logs and authentication material are not published. Source hashes identify the retained local originals; they are not hashes of the redacted text.

The live workflow stayed pinned to published v1.77.0, Claude Code 2.1.296 and Codex CLI 0.162.1 so the installation did not change across the human decision boundary. Later language-charter integration was checked separately against v1.80.0; these results do not claim a model rerun against that later artifact.

An operator comparison against release commit `b5012dbd0ce548da6889e017da6b176d693df6d5` confirmed every installed file matched tag v1.77.0: 56 Claude files and 59 Codex files, with no differences or extras.

| Observation | Claude | Codex |
| --- | --- | --- |
| Native discovery | 13 skills, 7 registrations | 13 skills, 7 registrations |
| Required research | Two sequential named research workers | Two sequential named research workers |
| First implementation tests | 7 passed | 5 passed |
| Injected defect | Extra stdout line; 4 tests failed | Extra stdout line; 5 tests failed |
| First independent verifier | FAIL on all 5 criteria | FAIL on 3 of 5 criteria |
| Directed repair | Standard implementation attempt 2 | Standard implementation attempt 2 |
| Fresh second verifier | All 5 criteria PASS | All 5 criteria PASS |
| Operator's final test rerun | 7 passed | 5 passed |

Both workflows opened implementation PR #3, transitioned ticket #2 to `in-review`, posted the ticket evidence comment and submitted a COMMENT review at the verified head. Claude's outcome was `APPROVED`; Codex's was `CHANGES_NEEDED`, including an inline fix requiring the service instance to use its interface type. Functional acceptance did not suppress charter feedback. These synthetic PRs remain unmerged as execution evidence; review remediation is a separate verified pass, not a reset of the implementation loop.

The test deliberately injects a defect after a passing first implementation. It proves that the verifier can reject a bad tree and direct a repair; it does not measure how often an implementation model creates defects. The Codex injection also included a comment identifying it as an operator defect. That comment is retained in the evidence, so this is not a blinded benchmark.

The run exposed two practical setup issues. Codex's actual checkout needed its own trust entry before the named selector appeared. Claude rejected a compound shell command, while separate `node` and `npm test` calls succeeded with the original permission rules. Neither problem was resolved with a bypass. The Codex parent requested a YAML-only repair of one worker report without rerunning implementation. The first Claude verifier added list-number prefixes to criterion strings, which its parent accepted; its final PASS used the original strings exactly. These observations describe native model behavior, not strict programmatic schema enforcement.

The operator also incorrectly requested a standard-tier tech-writer. Codex stopped; the operator corrected the request to the installed escalated registration, without changing the role or overriding its model. Claude used that registered role directly and reported the mismatch. The original prompt and correction remain in the record. Claude's writer repeated questions about the already supplied blank-line interpretation and documented Node minimum; those questions remain visible in its terminal report rather than being attributed to a new human reply.

Deterministic CI separately checks the runner's copied-login permissions, cleanup on success and client-discovery failure, refusal to replace an existing login, refusal to overwrite evidence, and termination of an unresponsive client. Those tests use a synthetic local executable and send no model requests. The live run establishes one bounded synthetic workflow per host; it does not establish E6 SDK/MCP behavior, every client version, every repository, or concurrent multi-parent scheduling.
