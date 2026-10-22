# Neutral SDK

The `@good-ground-collective/flight-rules/sdk` entry exposes canonical worker and skill instructions, orchestration contracts, and report validation. It does not start a worker or execute a skill. A host chooses the runtime, supplies tools and permissions, and owns dispatch identity.

```ts
import { instructionCatalog, WorkerReportCodec } from "@good-ground-collective/flight-rules/sdk";

const skillNames = instructionCatalog.listSkills();
const instructions = instructionCatalog.loadSkill("execute-work").contents;
const agent = instructionCatalog.loadAgent("code-implementation");
const report = new WorkerReportCodec().parse(workerText, {
  agent: "code-implementation",
  mode: "implement",
});
```

The catalog reads from the installed package, so callers can run from any working directory. `FLIGHT_RULES_HOME` can point to a different flight-rules installation when a host relocates its resources. Skill text and agent bodies come from canonical source files; named agent variants reuse their registered canonical prompt.

The SDK also exports the existing run context, dispatch, outcome, question, sibling skill, implementation, and verification contracts. `SkillInvocationResult` represents a skill that completes, fails, or pauses at a human question boundary. A host must retain the context and pause identity when it resumes that skill.

The SDK exposes the validated operation registry and each shared operation family, including tracker reads, plans and writes, ticket lifecycle, Git/configuration, pull requests, review, and Ariadne. Compose these services with a launch-bound `LaunchOperationAccessPolicy`; an operation's presence in the registry does not itself authorize a write or network effect. `DefaultTrackerEntityOperations` is the aggregate for tracker reads, ticket lifecycle and entity writes, so consumers should register that aggregate once.

`DefaultFlightRules.localOperations()` supplies the shared charter, competency, RFC, QA, config-read, and readiness operations. A host can register them alongside the existing document operation and invoke normalized inputs through the same validated registry used by the CLI:

```ts
import { createFlightRules } from "@good-ground-collective/flight-rules";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
} from "@good-ground-collective/flight-rules/sdk";

const core = createFlightRules({ cwd: process.cwd() });
const operations = core.localOperations();
const registry = new MapOperationRegistry({
  operations: operations.operations(),
  policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process", "network"] }),
});
const report = await registry.invoke("check", { workflow: "verify-ticket" });
```

Readiness runs environment probes without a runtime manifest. Programmatic callers may still pass a typed `WorkflowEvidence` object in `evidence` to opt into the existing caller/worker diagnostics; supplied evidence is validated and denied, unknown or mismatched observations still fail those checks. The exported schemas, types and service signatures remain available. Omitting evidence does not assert host permission or dispatch availability.

The CLI no longer accepts `--runtime-file`; use `flight-rules check --workflow <name>`. SDK callers that need explicit host diagnostics pass evidence in memory. Failed readiness checks remain in the successful structured report with `ok: false`, allowing a host to explain each unmet requirement.

`WorkerReportCodec` accepts one final fenced YAML block, parses it as JSON-compatible data, and checks the requested registration mode. Research reports may include short prose before the block; every report rejects trailing content and additional report blocks. Inline writer rewrites return `rewritten`, while file rewrites return `changes`. The available modes are implementation, verification, research (`internal`, `external`, or `mixed`), QA (`reproduce` or `verify`), and writer (`feedback`, `rewrite`, or `author`). A valid report is content from a worker; the host adds dispatch ID, agent identity, and caller context when it creates the terminal outcome.
