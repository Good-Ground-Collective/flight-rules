# Keeping native targets aligned

The shared skills and agent registry are canonical. Edit those sources and let the compiler/release regenerate the native targets. PR CI builds both targets, runs the test suite, and checks a complete release against a scratch Git remote and npm package.

The source guard enumerates every Markdown file below `skills/` and `agents/`. It rejects native tool/model instructions and host-specific document/config paths with a source file, line and remedy. Canonical examples follow the same capability vocabulary; native examples belong in adapter documentation.

Write named worker targets as backticked registry identifiers: `dispatch` with a named registration, a backticked name followed by “agent” or “worker”, or a table column named Agent, Worker or Registration. The guard recognizes those forms and all names currently in the registry, including tier variants. It does not infer arbitrary natural-language references or runtime-computed names. Add a regression fixture when introducing a new dispatch spelling; do not add a historical worker-name prefix to a regex.

`agent-source-drift.test.ts` owns the source/registry scan and package-coverage assertions. `source-drift-helpers.test.ts` deliberately introduces native names, forbidden paths and a completely new missing worker to verify actionable diagnostics. Existing CLI command/flag checks remain in `skill-cli-drift.test.ts`.

`plugin-compiler.test.ts` compiles both targets in-process from canonical fixtures. It checks skill bytes, resolved base/variant prompts, manifests and registration metadata. Negative controls add a new canonical worker after compilation and mutate emitted prompts/skills, then verify that the guard identifies the missing or changed target and explains how to repair it. The compiler fixture starts without a generated target; it never treats another target or a previous `dist/` tree as the expected prompt.

Schema and emitter suites continue to own strict neutral input validation, reserved expert-tier rationale and native metadata mappings. These deterministic guards complement the [native installation checks](./native-installation.md); installed model-driven workflow execution remains separate evidence.
