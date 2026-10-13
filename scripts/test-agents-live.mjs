#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const plugin = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const scratch = mkdtempSync(join(tmpdir(), "flight-rules-live-"));
const manifest = JSON.parse(readFileSync(join(plugin, ".claude-plugin/plugin.json"), "utf8"));
const models = JSON.parse(readFileSync(join(plugin, "adapters/claude/model-tiers.json"), "utf8"));
const expectedAgents = manifest.agents.map((path) => `flight-rules:${parseYaml(/^---\n([\s\S]*?)^---\n/m.exec(readFileSync(join(plugin, path), "utf8"))[1]).name}`);
const env = { ...process.env, PATH: `${join(plugin, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`, FLIGHT_RULES_HOME: plugin };
const settings = {
  disableAllHooks: true,
  autoMemoryEnabled: false,
  enabledPlugins: {},
  permissions: {
    allow: [
      `Edit(/${scratch}/answer.mjs)`, `Write(/${scratch}/answer.mjs)`, `Write(/${scratch}/evidence/**)`,
      "Bash(node *)", "Bash(flight-rules doc *)", "Bash(ls *)", "Bash(cat *)", "Bash(echo *)", "Bash(pwd)",
    ],
    deny: ["Agent", "WebSearch", "WebFetch", "Bash(git *)"],
  },
};
writeFileSync(join(scratch, "settings.json"), JSON.stringify(settings));
writeFileSync(join(scratch, "witness.txt"), "fixture-proof: 7642\n");
writeFileSync(join(scratch, "answer.mjs"), "export const answer = () => 41;\n");
writeFileSync(join(scratch, "answer.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { answer } from "./answer.mjs";\ntest("the answer is 42", () => assert.equal(answer(), 42));\n');
mkdirSync(join(scratch, "evidence"));
const initialTest = spawnSync(process.execPath, ["--test", "answer.test.mjs"], { cwd: scratch, encoding: "utf8" });
assert.equal(initialTest.status, 1, "fixture must start failing");
writeFileSync(join(scratch, "before-test.txt"), initialTest.stdout);

const constraints = " This is an isolated smoke test: do not run git, access a tracker, use the web or spawn agents. Run each charter command by itself and read its complete output without head or other truncation. Run tests separately. Shell permissions allow node, flight-rules doc, ls, cat, echo and pwd. A denied compound command does not mean all shell commands are denied. If a required command is denied, report that and stop before editing. Follow your registered instructions and finish with their required YAML.";
const cases = [
  {
    agent: "code-verifier", tier: "standard", docs: ["M-13"], readonly: true,
    prompt: "Verify the acceptance criterion: witness.txt contains exactly fixture-proof: 7642 followed by one newline. Inspect it yourself and check the exact bytes with a narrow Node command. Do not edit any files.",
  },
  {
    agent: "code-implementation-escalated", tier: "escalated", docs: ["M-13"], readonly: false,
    prompt: "Implement this smoke-test ticket: answer.mjs returns 41; make answer() return 42. Acceptance criteria: answer() returns 42 and node --test answer.test.mjs passes. Two previous verifications rejected 41; this is the final escalated attempt. Edit only answer.mjs, run the test and leave changes unstaged.",
  },
  {
    agent: "qa-engineer-verify", tier: "standard", docs: ["Q-10", "evidence-capture"], readonly: true,
    prompt: "Verify in verify mode. QA instructions: this is a CLI product whose answer() behavior is checked by node --test answer.test.mjs. Acceptance criterion: answer() returns 42. Evidence directory: evidence/ in this scratch directory. Read the QA charter and capture protocol through flight-rules doc, then capture text evidence of the test command and result under evidence/. Do not fix code, ask questions or modify files outside evidence/.",
  },
];
const report = { pluginVersion: manifest.version, scratch, discoveredAgents: [], cases: [], fixtureBefore: "fail", fixtureAfter: null };
console.log(`Live smoke test in ${scratch}; three Claude sessions capped at $1 each.`);

try {
  for (const test of cases) {
    console.log(`Running flight-rules:${test.agent}...`);
    const before = createHash("sha256").update(readFileSync(join(scratch, "answer.mjs"))).digest("hex");
    const args = [
      "--print", "--agent", `flight-rules:${test.agent}`, "--plugin-dir", plugin,
      "--setting-sources", "", "--settings", join(scratch, "settings.json"),
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--permission-mode", "dontAsk", "--max-budget-usd", "1",
      "--output-format", "stream-json", "--verbose", "--no-session-persistence",
    ];
    const result = spawnSync("claude", args, { cwd: scratch, env, input: test.prompt + constraints, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(join(scratch, `${test.agent}.jsonl`), result.stdout ?? "");
    writeFileSync(join(scratch, `${test.agent}.stderr`), result.stderr ?? "");
    assert.equal(result.status, 0, `Claude process failed: ${result.error?.message ?? result.stderr}`);
    const events = result.stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
    const init = events.find((event) => event.type === "system" && event.subtype === "init");
    const final = events.findLast((event) => event.type === "result");
    assert.ok(init, "missing startup metadata");
    report.discoveredAgents = expectedAgents.filter((agent) => init.agents?.includes(agent));
    assert.equal(report.discoveredAgents.length, expectedAgents.length, "host did not discover every registration");
    assert.ok(init.model.includes(models[test.tier]), `unexpected model ${init.model} for ${test.tier}`);
    assert.ok(init.tools.includes("Read") && init.tools.includes("Bash"), "required capabilities unavailable");
    if (test.readonly) assert.ok(!init.tools.includes("Edit") && !init.tools.includes("Write"), "read-only role gained editing tools");
    else assert.ok(init.tools.includes("Edit") && init.tools.includes("Write"), "implementation role lacks editing tools");
    assert.equal(final?.subtype, "success", "session did not complete");
    assert.equal(final?.is_error, false, "session reported a runtime error");
    assert.deepEqual(final.permission_denials ?? [], [], "fixture permission denial prevents a clean pass");
    const blocks = events.flatMap((event) => event.message?.content ?? []);
    const calls = blocks.filter((block) => block.type === "tool_use");
    const observations = blocks.filter((block) => block.type === "tool_result").map((block) => JSON.stringify(block.content)).join("\n");
    for (const marker of test.docs) assert.ok(observations.includes(marker), `full document evidence missing: ${marker}`);
    const match = /```yaml\r?\n([\s\S]*?)```\s*$/.exec(final.result);
    assert.ok(match, "missing trailing YAML report");
    const parsed = parseYaml(match[1]);
    if (test.agent !== "code-implementation-escalated") assert.equal(parsed.verified, true, "agent did not verify the criterion");
    else {
      assert.ok(parsed.filesChanged.some((file) => file.path === "answer.mjs"), "implementation omitted its changed file");
      assert.ok(calls.some((call) => call.name === "Bash" && call.input.command.includes("node --test answer.test.mjs")), "implementer never ran the test");
    }
    const after = createHash("sha256").update(readFileSync(join(scratch, "answer.mjs"))).digest("hex");
    if (test.readonly) assert.equal(after, before, "read-only role changed implementation");
    report.cases.push({ agent: test.agent, model: init.model, tools: init.tools, costUsd: final.total_cost_usd, commands: calls.filter((call) => call.name === "Bash").map((call) => call.input.command), verified: parsed.verified ?? null, report: parsed });
  }
  const finalTest = spawnSync(process.execPath, ["--test", "answer.test.mjs"], { cwd: scratch, encoding: "utf8" });
  writeFileSync(join(scratch, "after-test.txt"), finalTest.stdout);
  assert.equal(finalTest.status, 0, "independent verification failed after implementation");
  assert.equal(readFileSync(join(scratch, "witness.txt"), "utf8"), "fixture-proof: 7642\n");
  assert.ok(readdirSync(join(scratch, "evidence")).length > 0, "QA did not capture evidence");
  report.fixtureAfter = "pass";
  writeFileSync(join(scratch, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(scratch, "report.json"), `${JSON.stringify({ ...report, error: error.message }, null, 2)}\n`);
  console.error(`Live smoke test failed; evidence is in ${scratch}: ${error.message}`);
  process.exitCode = 1;
}
