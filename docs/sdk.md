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

`WorkerReportCodec` accepts exactly one final fenced YAML block, parses it as JSON-compatible data, and checks the requested registration mode. The available modes are implementation, verification, research (`internal`, `external`, or `mixed`), QA (`reproduce` or `verify`), and writer (`feedback`, `rewrite`, or `author`). A valid report is content from a worker; the host adds dispatch ID, agent identity, and caller context when it creates the terminal outcome.
