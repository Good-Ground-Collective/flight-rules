#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "flight-rules-consumers-"));
const deadline = 120_000;
const scrubbedEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OPENAI|ANTHROPIC|GOOGLE|AWS|AZURE|COHERE|MISTRAL|GEMINI|GITHUB|JIRA)_/.test(key))
      delete env[key];
  }
  for (const key of ["FLIGHT_RULES_HOST", "FLIGHT_RULES_HOME", "FLIGHT_RULES_CONFIG"])
    delete env[key];
  return env;
};
const run = (command, args, cwd, env = scrubbedEnv()) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: deadline,
    killSignal: "SIGKILL",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
};
const write = (path, contents) => writeFileSync(path, contents);
const packageVersion = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).version;

try {
  const packOutput = run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", scratch, "--json"],
    repository,
  );
  const packed = JSON.parse(packOutput)[0];
  const archive = join(scratch, packed.filename);
  const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(repository, "package-lock.json"), "utf8"));
  const distributionFiles = packed.files.filter(({ path }) => path.startsWith("dist/"));
  const measuredFootprint = {
    packedTarballBytes: packed.size,
    unpackedPackageBytes: packed.unpackedSize,
    productionDependencies: Object.keys(manifest.dependencies ?? {}).length,
    lockProductionEntries: Object.entries(lock.packages ?? {}).filter(
      ([path, entry]) => path !== "" && !entry.dev && !entry.devOptional,
    ).length,
    distFiles: distributionFiles.length,
    distBytes: distributionFiles.reduce((sum, file) => sum + file.size, 0),
    cliBytes: packed.files.find(({ path }) => path === "bin/flight-rules.mjs")?.size ?? 0,
    claudeBytes: packed.files
      .filter(({ path }) => path.startsWith("dist/claude/"))
      .reduce((sum, file) => sum + file.size, 0),
    codexBytes: packed.files
      .filter(({ path }) => path.startsWith("dist/codex/"))
      .reduce((sum, file) => sum + file.size, 0),
  };
  const lean = join(scratch, "lean");
  const full = join(scratch, "with-peers");
  mkdirSync(lean);
  mkdirSync(full);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], lean);
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "typescript@^6.0.3",
      "@types/node@^25.9.1",
    ],
    lean,
  );
  const leanModules = join(lean, "node_modules");
  for (const peer of ["deepagents", "langchain", "@langchain/core", "@langchain/langgraph"]) {
    assert.equal(
      existsSync(join(leanModules, peer)),
      false,
      `optional peer unexpectedly installed: ${peer}`,
    );
  }

  const leanSource = join(lean, "consumer.mts");
  write(
    leanSource,
    `
import { appVersion, createFlightRules } from "@good-ground-collective/flight-rules";
import { FileReviewPolicy, reviewContract } from "@good-ground-collective/flight-rules/review";
import { instructionCatalog, MapOperationRegistry } from "@good-ground-collective/flight-rules/sdk";
const policy = new FileReviewPolicy();
if (!appVersion || !createFlightRules({ cwd: process.cwd(), env: {} }) || !reviewContract || !policy || !instructionCatalog || !MapOperationRegistry) throw new Error("consumer exports unavailable");
`,
  );
  run(
    process.execPath,
    [
      join(repository, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--types",
      "node",
      "--skipLibCheck",
      "false",
      leanSource,
    ],
    lean,
  );
  const leanImport = run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { appVersion } from '@good-ground-collective/flight-rules';
    import { FileReviewPolicy, reviewContract } from '@good-ground-collective/flight-rules/review';
    import { instructionCatalog, MapOperationRegistry } from '@good-ground-collective/flight-rules/sdk';
    assert.equal(appVersion, ${JSON.stringify(packageVersion)});
    assert.ok(new FileReviewPolicy().load().method.length > 0);
    assert.ok(reviewContract && instructionCatalog && MapOperationRegistry);
    console.log('root, review, neutral SDK imports passed');
  `,
    ],
    lean,
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
      "deepagents@1.15.0",
      "langchain@1.5.16",
      "@langchain/core@1.2.17",
      "@langchain/langgraph@1.5.0",
      "@modelcontextprotocol/client@2.3.1",
      "typescript@^6.0.3",
      "@types/node@^25.9.1",
    ],
    full,
  );
  const fullManifestPath = join(full, "package.json");
  const fullManifest = JSON.parse(readFileSync(fullManifestPath, "utf8"));
  write(fullManifestPath, `${JSON.stringify({ ...fullManifest, type: "module" }, null, 2)}\n`);
  const example = join(repository, "examples/deepagents/iterative-review.ts");
  cpSync(example, join(full, "iterative-review.ts"));
  const exampleResult = run(
    process.execPath,
    ["--experimental-strip-types", join(full, "iterative-review.ts")],
    full,
  );
  assert.match(
    exampleResult,
    /"blockedModelRequests": 0/,
    "the graph must reject model-provider network requests and make none",
  );
  assert.match(exampleResult, /questionAnswerBoundary.*resumed original checkpoint/);
  assert.ok(
    exampleResult.includes('"trustedRepositoryContext"') &&
      exampleResult.includes('"CODE-REVIEW.md"'),
  );
  assert.match(exampleResult, /firstPassFinding.*open/);
  assert.match(exampleResult, /finalPassFinding.*resolved/);
  assert.match(exampleResult, /directed-implementation-retry/);
  assert.match(exampleResult, /finalState.*verified/);

  const adapterSource = join(full, "adapter-consumer.mts");
  write(
    adapterSource,
    `
import { LangChainDeepAgentsSkillRuntime, DeepAgentsWorkerRuntime } from "@good-ground-collective/flight-rules/sdk/deepagents";
import { FileReviewPolicy, EvidenceReviewPlanner, JsonReviewCodec } from "@good-ground-collective/flight-rules/review";
void [LangChainDeepAgentsSkillRuntime, DeepAgentsWorkerRuntime, FileReviewPolicy, EvidenceReviewPlanner, JsonReviewCodec];
`,
  );
  run(
    process.execPath,
    [
      join(full, "node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--types",
      "node",
      "--skipLibCheck",
      "false",
      adapterSource,
      join(full, "iterative-review.ts"),
    ],
    full,
  );

  const mcpProof = join(full, "mcp-proof.mjs");
  write(
    mcpProof,
    `
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const fixture = mkdtempSync(join(tmpdir(), 'flight-rules-mcp-installed-'));
const configPath = join(fixture, 'flight-rules.yml');
const binaries = process.argv.slice(2);
let routeContractCalls = 0;
const eofResults = [];
const sampleValue = (schema, root = schema, depth = 0) => {
  if (depth > 8) return null;
  if (schema.$ref) {
    const key = schema.$ref.split('/').at(-1);
    return sampleValue(root.$defs?.[key] ?? {}, root, depth + 1);
  }
  if (schema.enum?.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf?.length) return sampleValue(schema.anyOf[0], root, depth + 1);
  if (schema.oneOf?.length) return sampleValue(schema.oneOf[0], root, depth + 1);
  if (schema.type === 'object' || schema.properties) {
    const value = {};
    for (const key of schema.required ?? []) value[key] = sampleValue(schema.properties?.[key] ?? {}, root, depth + 1);
    if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') return value;
    return value;
  }
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sampleValue(schema.items ?? {}, root, depth + 1));
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? (schema.exclusiveMinimum ?? 0) + 1;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'null') return null;
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return '2026-10-14T12:00:00.000Z';
    if (schema.pattern?.includes('{40}')) return 'a'.repeat(40);
    if (schema.pattern?.includes('^https:')) return 'https://example.invalid/proof';
    if (schema.pattern?.includes('f-')) return 'f-0000000000';
    if (schema.pattern?.includes('A-Za-z0-9_.-')) return 'fixture/example';
    if (schema.pattern?.includes('path') || schema.pattern?.includes('Cc')) return 'src/fixture.ts';
    return schema.minLength > 1 ? 'fixture'.repeat(Math.ceil(schema.minLength / 7)) : 'fixture';
  }
  return {};
};
const invalidValue = (schema, root) => {
  if (schema.$ref) return invalidValue(root.$defs?.[schema.$ref.split('/').at(-1)] ?? {}, root);
  if (schema.anyOf?.length || schema.oneOf?.length) return 'invalid-contract-value';
  if (schema.type === 'string') return 17;
  if (schema.type === 'integer' || schema.type === 'number') return 'invalid-contract-value';
  if (schema.type === 'boolean') return 'invalid-contract-value';
  if (schema.type === 'array') return 'invalid-contract-value';
  if (schema.type === 'object') return 'invalid-contract-value';
  return undefined;
};
const invalidObject = (schema, valid) => {
  for (const key of [...(schema.required ?? []), ...Object.keys(schema.properties ?? {})]) {
    const candidate = invalidValue(schema.properties?.[key] ?? {}, schema);
    if (candidate !== undefined) return { ...valid, [key]: candidate };
  }
  return null;
};
const domainInvalidObject = (name) => {
  if (name === 'review-validate') return { review: {} };
  if (name === 'review-state') return { state: {} };
  return null;
};
const eofExit = (binary) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [binary, 'mcp'], { cwd: fixture, env: { ...process.env, FLIGHT_RULES_CONFIG: configPath, HOME: fixture }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let pending = '';
  let initializationResponse;
  const records = [];
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('EOF probe timed out for ' + binary)); }, 10000);
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    pending += chunk;
    const lines = pending.split('\\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      records.push(record);
      if (record.id === 1) {
        initializationResponse = record;
        assert.equal(record.jsonrpc, '2.0');
        assert.ok(record.result?.protocolVersion, 'MCP initialize response must be framed JSON-RPC');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
        child.stdin.end();
      }
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    try {
      assert.equal(signal, null, 'EOF shutdown must not require a signal for ' + binary + ': ' + stderr);
      assert.equal(code, 0, 'EOF shutdown must exit cleanly for ' + binary + ': ' + stderr);
      assert.ok(records.every((record) => record.jsonrpc === '2.0'), 'stdout must contain only framed JSON-RPC records');
      assert.ok(initializationResponse, 'EOF probe must initialize a real MCP session before closing stdin');
      resolve({ code, signal, stdoutRecords: records.length, initialized: true });
    } catch (error) { reject(error); }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'eof-proof', version: '1.0.0' } } }) + '\\n');
});
try {
  for (const binary of binaries) {
    const eof = await eofExit(binary);
    assert.deepEqual(eof, { code: 0, signal: null, stdoutRecords: 1, initialized: true });
    eofResults.push({ binary: binary.split('/').slice(-3).join('/'), ...eof });
    for (const mode of ['auto', 'legacy']) {
      const childEnv = { ...process.env, FLIGHT_RULES_CONFIG: configPath, HOME: fixture };
      for (const key of ['GITHUB_TOKEN', 'JIRA_TOKEN', 'JIRA_API_TOKEN', 'JIRA_API_KEY']) delete childEnv[key];
      const transport = new StdioClientTransport({ command: process.execPath, args: [binary, 'mcp'], cwd: fixture, env: childEnv, stderr: 'pipe' });
      const client = new Client({ name: 'installed-consumer-proof', version: '1.0.0' }, { versionNegotiation: { mode } });
      const protocolErrors = [];
      transport.onerror = (error) => protocolErrors.push(error.message);
      client.onerror = (error) => protocolErrors.push(error.message);
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.equal(tools.length, 60, binary + ' (' + mode + ')');
        assert.ok(tools.some(({ name }) => name === 'ticket-create'));
        assert.ok(tools.some(({ name }) => name === 'packet-reviewers'));
        for (const tool of tools) {
          const validInput = sampleValue(tool.inputSchema);
          if (tool.name === 'ticket-label') validInput.add = ['fixture'];
          const valid = await client.callTool({ name: tool.name, arguments: validInput });
          const validText = JSON.stringify(valid);
          assert.doesNotMatch(validText, /OperationInputError|Invalid input for |Input validation error/, tool.name + ' rejected generated valid contract input');
          const envelope = valid.structuredContent;
          if (envelope?.status !== undefined) {
            assert.ok(['success', 'error', 'partial'].includes(envelope.status), tool.name + ' returned an unknown operation envelope');
            if (envelope.status === 'error') assert.ok(typeof envelope.error?.name === 'string', tool.name + ' domain error must be named');
            if (envelope.status === 'partial') assert.ok(typeof envelope.error?.name === 'string', tool.name + ' partial result must name its warning');
          } else {
            assert.notEqual(valid.isError, true, tool.name + ' valid route call returned a protocol error');
          }
          const invalid = domainInvalidObject(tool.name) ?? invalidObject(tool.inputSchema, sampleValue(tool.inputSchema));
          if (invalid === null) {
            const invalidResult = await client.callTool({ name: tool.name, arguments: 'invalid-contract-input' }).then((value) => ({ value }), (error) => ({ error }));
            if ('value' in invalidResult) {
              assert.equal(invalidResult.value.isError, true, tool.name + ' accepted a non-object contract input');
              assert.match(JSON.stringify(invalidResult.value), new RegExp('Invalid tools/call request|Invalid input: expected object|ZodError'), tool.name + ' did not expose a known schema/domain validation result');
            } else {
              assert.match(invalidResult.error.message, new RegExp('Invalid tools/call request'), tool.name + ' did not reject a non-object at the protocol schema boundary');
            }
          } else {
            const rejected = await client.callTool({ name: tool.name, arguments: invalid });
            assert.equal(rejected.isError, true, tool.name + ' accepted an invalid route-specific object input');
            assert.match(JSON.stringify(rejected), /Input validation error|Invalid input for |ZodError/, tool.name + ' invalid route input was not rejected by its schema/domain contract');
          }
          routeContractCalls += 2;
        }
        const invalid = await client.callTool({ name: 'ticket-get', arguments: {} });
        assert.equal(invalid.isError, true);
        const denied = await client.callTool({ name: 'config-set', arguments: { key: 'repo', values: ['fixture/example'], scope: 'file' } });
        assert.equal(denied.isError, true);
        assert.equal(existsSync(configPath), false, 'default write denial must precede side effects');
        assert.deepEqual(protocolErrors, [], 'stdout framing must not produce protocol errors');
      } finally {
        await client.close();
        await transport.close();
      }

      const permittedTransport = new StdioClientTransport({
        command: process.execPath,
        args: [binary, 'mcp', '--allow-operation', 'config-set', '--allow-config-scope', 'file'],
        cwd: fixture,
        env: { ...process.env, FLIGHT_RULES_CONFIG: configPath, HOME: fixture },
        stderr: 'pipe',
      });
      const permittedClient = new Client({ name: 'installed-consumer-write-proof', version: '1.0.0' }, { versionNegotiation: { mode } });
      const permittedProtocolErrors = [];
      permittedTransport.onerror = (error) => permittedProtocolErrors.push(error.message);
      permittedClient.onerror = (error) => permittedProtocolErrors.push(error.message);
      try {
        await permittedClient.connect(permittedTransport);
        const written = await permittedClient.callTool({ name: 'config-set', arguments: { key: 'repo', values: ['fixture/example'], scope: 'file' } });
        assert.notEqual(written.isError, true, binary + ' (' + mode + ')');
        assert.ok(readFileSync(configPath, 'utf8').includes('fixture/example'));
        assert.deepEqual(permittedProtocolErrors, [], 'permitted-write stdout framing must not produce protocol errors');
        rmSync(configPath, { force: true });
      } finally {
        await permittedClient.close();
        await permittedTransport.close();
      }
    }
  }
} finally { rmSync(fixture, { recursive: true, force: true }); }
console.log(JSON.stringify({ routeContractCalls, eofResults }));
`,
  );
  const extracted = join(scratch, "unpack");
  mkdirSync(extracted);
  run("tar", ["-xzf", archive, "-C", extracted], scratch);
  const packageRoot = join(extracted, "package");
  const relocated = join(scratch, "relocated-native");
  mkdirSync(relocated);
  cpSync(join(packageRoot, "dist/claude"), join(relocated, "claude"), { recursive: true });
  cpSync(join(packageRoot, "dist/codex"), join(relocated, "codex"), { recursive: true });
  const relocatedArgs = [
    join(packageRoot, "bin/flight-rules.mjs"),
    join(relocated, "claude/bin/flight-rules.mjs"),
    join(relocated, "codex/bin/flight-rules.mjs"),
  ];
  const mcpOutput = run(process.execPath, [mcpProof, ...relocatedArgs], full);
  const mcpMetrics = JSON.parse(mcpOutput);

  const report = {
    packageVersion,
    archive,
    measuredFootprint,
    isolated: {
      leanInstall: true,
      optionalPeersAbsent: true,
      checkoutNodeModulesLink: false,
      rootReviewNeutralSdkImports: true,
    },
    declarationChecks: {
      productionOnlySkipLibCheckFalse: true,
      peerInstalledSkipLibCheckFalse: true,
    },
    deterministicDeepAgentsGraph: {
      example: "examples/deepagents/iterative-review.ts",
      providerCalls: 0,
      result: JSON.parse(exampleResult),
    },
    mcpClients: {
      toolsPerBinary: 60,
      packedAndRelocatedClis: relocatedArgs.length,
      validAndInvalidInputsPerRoute: true,
      ...mcpMetrics,
      invalidInputRejected: true,
      stdoutFramingChecked: true,
      eofExit: "code 0 / signal null",
    },
    scratch,
  };
  writeFileSync(join(scratch, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(
    join(scratch, "failure.json"),
    JSON.stringify({ message: error.message, scratch }, null, 2),
  );
  console.error(
    `Installed consumer proof failed; evidence is in ${scratch}/failure.json: ${error.message}`,
  );
  process.exitCode = 1;
}
