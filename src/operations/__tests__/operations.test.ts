import { Command } from "commander";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { DocOperation } from "../doc-operation.js";
import { CliRouteCoverage, CliRouteCoverageError, cliRouteCoverage } from "../cli-coverage.js";
import {
  LaunchOperationAccessPolicy,
  OperationInputError,
  OperationRegistry,
} from "../operation-registry.js";
import type { OperationDescriptor } from "../operation-registry.js";
import { buildProgram } from "../../cli/cli.js";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import type { DocResolver } from "../../bundled-docs/doc-resolver/doc-resolver.js";

const resolver: DocResolver = {
  list: () => ["workflow"],
  resolve: id => ({ id, path: `/install/docs/${id}.md`, contents: "Workflow\n" }),
};

describe("shared operations", () => {
  it("invokes the document descriptor with validated shared inputs and output", async () => {
    const registry = new OperationRegistry({
      operations: [new DocOperation({ getResolver: () => resolver })],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });

    await expect(registry.invoke("doc", { id: "workflow" })).resolves.toEqual({
      status: "success",
      data: { id: "workflow", path: "/install/docs/workflow.md", contents: "Workflow\n" },
    });
    await expect(registry.invoke("doc", { id: "../secret" })).rejects.toBeInstanceOf(OperationInputError);
  });

  it("denies access before a handler can resolve its service", async () => {
    const getResolver = vi.fn(() => resolver);
    const registry = new OperationRegistry({ operations: [new DocOperation({ getResolver })] });

    await expect(registry.invoke("doc", { id: "workflow", allowedEffects: ["read"] })).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationAccessDeniedError" },
    });
    expect(getResolver).not.toHaveBeenCalled();
  });

  it("validates handler output and represents resolver failures as error envelopes", async () => {
    const malformed: OperationDescriptor<{ id: string }, unknown> = {
      id: "doc",
      description: "Malformed test output",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.custom<unknown>(() => false),
      effects: ["read"],
      cli: { path: ["doc"], aliases: [] },
      handler: () => ({ id: "workflow", path: "/doc.md", contents: "invalid" }),
    };
    const malformedRegistry = new OperationRegistry({
      operations: [malformed],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });
    await expect(malformedRegistry.invoke("doc", { id: "workflow" })).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationOutputError" },
    });

    const failingRegistry = new OperationRegistry({
      operations: [new DocOperation({ getResolver: () => ({ ...resolver, resolve: () => { throw new Error("missing"); } }) })],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });
    await expect(failingRegistry.invoke("doc", { id: "workflow" })).resolves.toMatchObject({
      status: "error",
      error: { name: "Error", message: "missing" },
    });
  });

  it("validates data in partial-result envelopes", async () => {
    const operation: OperationDescriptor<{ id: string }, { value: string }> = {
      id: "doc",
      description: "Partial test result",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      effects: ["read"],
      cli: { path: ["doc"], aliases: [] },
      handler: () => ({ status: "partial", data: { value: "available" }, error: { name: "Warning", message: "Some details are unavailable" } }),
    };
    const registry = new OperationRegistry({
      operations: [operation],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });

    await expect(registry.invoke("doc", { id: "workflow" })).resolves.toEqual({
      status: "partial",
      data: { value: "available" },
      error: { name: "Warning", message: "Some details are unavailable" },
    });
  });

  it("discovers all existing CLI routes once and keeps pending routes unavailable to completion", () => {
    const core = createFlightRules();
    const program = buildProgram(
      override => core.tracker(override),
      override => core.config(override),
      override => core.prHost(override),
      () => core.configPath(),
      core,
    );
    const routes = cliRouteCoverage.check(program);
    expect(routes).toHaveLength(68);
    expect(routes.filter(route => route.aliases.length > 0)).toEqual([
      { path: ["hook", "pre-bash"], aliases: ["guard-commit"] },
    ]);
    expect(cliRouteCoverage.list().filter(item => item.status === "excluded")).toHaveLength(8);
    expect(() => cliRouteCoverage.assertComplete(program)).toThrow(/remain pending migration/);
  });

  it("rejects a newly discovered command without an explicit disposition", () => {
    const program = new Command("sample");
    program.command("new-route").action(() => undefined);
    const coverage = new CliRouteCoverage({
      entries: [{ status: "supported", route: { path: ["known"], aliases: [] }, operationId: "known" }],
    });

    expect(CliRouteCoverage.discover(program)).toEqual([{ path: ["new-route"], aliases: [] }]);
    expect(() => coverage.check(program)).toThrow(CliRouteCoverageError);
  });

  it("rejects duplicate route dispositions", () => {
    const program = new Command("sample");
    program.command("known").action(() => undefined);
    const coverage = new CliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["known"], aliases: [] }, operationId: "known" },
        { status: "pending-migration", route: { path: ["known"], aliases: [] }, operationId: "known-pending" },
      ],
    });

    expect(() => coverage.check(program)).toThrow(/Duplicate route disposition/);
  });
});
