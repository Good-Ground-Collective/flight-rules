import { Command } from "commander";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { DocOperation } from "../doc-operation.js";
import {
  ManifestCliRouteCoverage,
  CliRouteCoverageError,
  cliRouteCoverage,
} from "../cli-coverage.js";
import {
  DuplicateOperationIdError,
  LaunchOperationAccessPolicy,
  OperationInputError,
  MapOperationRegistry,
} from "../operation-registry.js";
import type { OperationDescriptor } from "../operation-registry.js";
import type { OperationEffect } from "../operation.schema.js";
import { buildProgram } from "../../cli/cli.js";
import { createFlightRules } from "../../flight-rules/flight-rules.js";
import type { DocResolver } from "../../bundled-docs/doc-resolver/doc-resolver.js";
import { DefaultPrOperations } from "../pr-operations.js";

const resolver: DocResolver = {
  list: () => ["workflow"],
  resolve: (id) => ({ id, path: `/install/docs/${id}.md`, contents: "Workflow\n" }),
};

describe("shared operations", () => {
  it("invokes the document descriptor with validated shared inputs and output", async () => {
    const registry = new MapOperationRegistry({
      operations: [new DocOperation({ getResolver: () => resolver })],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });

    await expect(registry.invoke("doc", { id: "workflow" })).resolves.toEqual({
      status: "success",
      data: { id: "workflow", path: "/install/docs/workflow.md", contents: "Workflow\n" },
    });
    await expect(registry.invoke("doc", { id: "../secret" })).rejects.toBeInstanceOf(
      OperationInputError,
    );
  });

  it("denies access before a handler can resolve its service", async () => {
    const getResolver = vi.fn(() => resolver);
    const registry = new MapOperationRegistry({ operations: [new DocOperation({ getResolver })] });

    await expect(
      registry.invoke("doc", { id: "workflow", allowedEffects: ["read"] }),
    ).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationAccessDeniedError" },
    });
    expect(getResolver).not.toHaveBeenCalled();
  });

  it("keeps launch authorization and handler metadata detached from descriptor mutations", async () => {
    const handler = vi.fn(function (this: { calls: number }, input: { id: string }) {
      this.calls += 1;
      return { calls: this.calls, id: input.id };
    });
    const descriptor = {
      id: "snapshot",
      description: "A descriptor whose caller-owned fields can change",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ calls: z.number(), id: z.string() }),
      effects: ["write"] as OperationEffect[],
      cli: { path: ["doc"], aliases: [] as string[] },
      calls: 0,
      handler,
    };
    const registry = new MapOperationRegistry({ operations: [descriptor] });

    descriptor.effects.splice(0, 1, "read");
    descriptor.cli.path[0] = "changed";
    descriptor.id = "changed";
    Reflect.set(descriptor, "inputSchema", z.never());
    Reflect.set(descriptor, "outputSchema", z.never());
    Reflect.set(descriptor, "handler", vi.fn());

    const discovered = registry.list();
    discovered[0]?.effects.splice(0, 1, "read");
    if (discovered[0] !== undefined) discovered[0].cli.path[0] = "changed";

    await expect(registry.invoke("snapshot", { id: "workflow" })).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationAccessDeniedError" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([
      {
        id: "snapshot",
        description: "A descriptor whose caller-owned fields can change",
        effects: ["write"],
        cli: { path: ["doc"], aliases: [] },
      },
    ]);
  });

  it("keeps captured schemas and the original bound handler after descriptor mutation", async () => {
    const descriptor = {
      id: "snapshot",
      description: "A bound operation",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ calls: z.number(), id: z.string() }),
      effects: ["read"] as OperationEffect[],
      cli: { path: ["doc"], aliases: [] as string[] },
      calls: 0,
      handler(input: { id: string }) {
        this.calls += 1;
        return { calls: this.calls, id: input.id };
      },
    };
    const registry = new MapOperationRegistry({
      operations: [descriptor],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });

    Reflect.set(descriptor, "inputSchema", z.never());
    Reflect.set(descriptor, "outputSchema", z.never());
    Reflect.set(descriptor, "handler", () => ({ calls: -1, id: "wrong" }));

    await expect(registry.invoke("snapshot", { id: "workflow" })).resolves.toEqual({
      status: "success",
      data: { calls: 1, id: "workflow" },
    });
    expect(descriptor.calls).toBe(1);
    await expect(registry.invoke("snapshot", { id: 5 })).rejects.toBeInstanceOf(
      OperationInputError,
    );
  });

  it("throws a named error for duplicate operation IDs", () => {
    const operation = new DocOperation({ getResolver: () => resolver });
    expect(() => new MapOperationRegistry({ operations: [operation, operation] })).toThrow(
      DuplicateOperationIdError,
    );
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
    const malformedRegistry = new MapOperationRegistry({
      operations: [malformed],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });
    await expect(malformedRegistry.invoke("doc", { id: "workflow" })).resolves.toMatchObject({
      status: "error",
      error: { name: "OperationOutputError" },
    });

    const failingRegistry = new MapOperationRegistry({
      operations: [
        new DocOperation({
          getResolver: () => ({
            ...resolver,
            resolve: () => {
              throw new Error("missing");
            },
          }),
        }),
      ],
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
      handler: () => ({
        status: "partial",
        data: { value: "available" },
        error: { name: "Warning", message: "Some details are unavailable" },
      }),
    };
    const registry = new MapOperationRegistry({
      operations: [operation],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read"] }),
    });

    await expect(registry.invoke("doc", { id: "workflow" })).resolves.toEqual({
      status: "partial",
      data: { value: "available" },
      error: { name: "Warning", message: "Some details are unavailable" },
    });
  });

  it("discovers all CLI routes once and registers tracker reads and plans as shared operations", () => {
    const core = createFlightRules();
    const program = buildProgram(
      (override) => core.tracker(override),
      (override) => core.config(override),
      (override) => core.prHost(override),
      () => core.configPath(),
      core,
    );
    const registry = new MapOperationRegistry({
      operations: [
        new DocOperation({ getResolver: () => core.docs() }),
        ...core.localOperations().operations(),
        ...core.gitConfigOperations().operations(),
        ...core.reviewOperations().operations(),
        ...core.trackerEntityOperations().operations(),
        ...new DefaultPrOperations({
          cwd: process.cwd(),
          getHost: () => core.prHost(),
        }).operations(),
        ...(core.ariadneOperations?.().operations() ?? []),
      ],
      policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process", "network"] }),
    });
    const routes = cliRouteCoverage.check(program, registry);
    expect(routes).toHaveLength(69);
    expect(routes.filter((route) => route.aliases.length > 0)).toEqual([
      { path: ["hook", "pre-bash"], aliases: ["guard-commit"] },
    ]);
    const excluded = cliRouteCoverage.list().filter((item) => item.status === "excluded");
    expect(excluded).toHaveLength(9);
    expect(excluded.find((item) => item.route.path.join(" ") === "mcp")).toMatchObject({
      reason: expect.stringContaining("local stdio transport"),
    });
    expect(() => cliRouteCoverage.assertComplete(program, registry)).toThrow(
      /remain pending migration/,
    );
    expect(registry.list().map((operation) => operation.id)).toEqual([
      "doc",
      "charter",
      "competencies",
      "rfc-dir",
      "rfc-next-id",
      "qa-instructions",
      "qa-evidence-dir",
      "qa-recipe",
      "config-path",
      "config-show",
      "check",
      "config-set",
      "config-unset",
      "git-commit",
      "git-checkout",
      "git-push",
      "commit-message",
      "branch-name",
      "review-schema",
      "review-validate",
      "review-render",
      "review-state",
      "review-context",
      "review-plan",
      "ticket-get",
      "ticket-transitions",
      "users-get",
      "tdd-get",
      "epic-get",
      "initiative-get",
      "epic-plan",
      "epic-review-plan",
      "initiative-plan",
      "initiative-review-plan",
      "epic-create",
      "epic-edit",
      "epic-link-initiative",
      "initiative-create",
      "initiative-edit",
      "ticket-create",
      "ticket-edit",
      "tdd-create",
      "pr-create",
      "pr-comment",
      "pr-list",
      "pr-request-review",
      "board-post-heartbeat",
      "board-post-item",
      "board-post-activity",
      "board-items",
      "packet-create",
      "packet-new-id",
      "packet-update",
      "packet-get",
      "packet-reviewers",
    ]);
  });

  it("rejects a newly discovered command without an explicit disposition", () => {
    const program = new Command("sample");
    program.command("new-route").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["known"], aliases: [] }, operationId: "known" },
      ],
    });

    expect(ManifestCliRouteCoverage.discover(program)).toEqual([
      { path: ["new-route"], aliases: [] },
    ]);
    expect(() => coverage.check(program, { list: () => [] })).toThrow(CliRouteCoverageError);
  });

  it("rejects duplicate route dispositions", () => {
    const program = new Command("sample");
    program.command("known").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["known"], aliases: [] }, operationId: "known" },
        {
          status: "pending-migration",
          route: { path: ["known"], aliases: [] },
          operationId: "known-pending",
        },
      ],
    });

    expect(() => coverage.check(program, { list: () => [] })).toThrow(
      /Duplicate route disposition/,
    );
  });

  it("rejects duplicate actionable Commander routes", () => {
    const program = new Command("sample");
    const hello = new Command("hello").action(() => undefined);
    Object.defineProperty(program, "commands", { value: [hello, hello] });
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["hello"], aliases: [] }, operationId: "hello-op" },
      ],
    });

    expect(() => coverage.check(program, { list: () => [] })).toThrow(
      /Duplicate actionable CLI route/,
    );
  });

  it("rejects supported coverage without a matching executable operation", () => {
    const program = new Command("sample");
    program.command("hello").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["hello"], aliases: [] }, operationId: "missing" },
      ],
    });

    expect(() => coverage.assertComplete(program, { list: () => [] })).toThrow(
      /exactly one executable operation/,
    );
  });

  it("rejects supported operations whose executable CLI mapping differs", () => {
    const program = new Command("sample");
    program.command("hello").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["hello"], aliases: [] }, operationId: "hello-op" },
      ],
    });

    expect(() =>
      coverage.check(program, {
        list: () => [
          {
            id: "hello-op",
            description: "Hello",
            effects: ["read"],
            cli: { path: ["other"], aliases: [] },
          },
        ],
      }),
    ).toThrow(/no supported CLI route|mapping mismatch/);
  });

  it("rejects executable descriptors for pending routes", () => {
    const program = new Command("sample");
    program.command("future").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        {
          status: "pending-migration",
          route: { path: ["future"], aliases: [] },
          operationId: "future-op",
        },
      ],
    });

    expect(() =>
      coverage.check(program, {
        list: () => [
          {
            id: "future-op",
            description: "Future",
            effects: ["read"],
            cli: { path: ["future"], aliases: [] },
          },
        ],
      }),
    ).toThrow(/no supported CLI route/);
  });

  it("rejects multiple executable operations mapped to one CLI route", () => {
    const program = new Command("sample");
    program.command("hello").action(() => undefined);
    const coverage = new ManifestCliRouteCoverage({
      entries: [
        { status: "supported", route: { path: ["hello"], aliases: [] }, operationId: "hello-op" },
      ],
    });

    expect(() =>
      coverage.check(program, {
        list: () => [
          {
            id: "hello-op",
            description: "Hello",
            effects: ["read"],
            cli: { path: ["hello"], aliases: [] },
          },
          {
            id: "other-op",
            description: "Also hello",
            effects: ["read"],
            cli: { path: ["hello"], aliases: [] },
          },
        ],
      }),
    ).toThrow(/Duplicate executable operation route/);
  });
});
