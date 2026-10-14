import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocCommand } from "../command.js";
import { DocNotFoundError } from "../../../doc-resolver/doc-resolver.js";
import type { OperationCliError } from "../../../../operations/operation-registry.js";
import type { DocResolver } from "../../../doc-resolver/doc-resolver.js";

const run = (resolver: DocResolver, args: string[]) =>
  createDocCommand({ getResolver: () => resolver }).parseAsync(args, { from: "user" });
const resolver: DocResolver = {
  list: () => ["alpha"],
  resolve: (id) => {
    if (id !== "alpha") throw new DocNotFoundError({ id, available: ["alpha"] });
    return { id, path: "/install/docs/alpha.md", contents: "Alpha" };
  },
};

describe("doc command", () => {
  afterEach(() => vi.restoreAllMocks());
  it("prints contents with a trailing newline", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run(resolver, ["alpha"]);
    expect(output).toHaveBeenCalledWith("Alpha\n");
  });
  it("preserves existing trailing newlines", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run(
      { ...resolver, resolve: (id) => ({ id, path: "/alpha.md", contents: "Alpha\n\n" }) },
      ["alpha"],
    );
    expect(output).toHaveBeenCalledWith("Alpha\n\n");
  });
  it("prints only the path with --path", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run(resolver, ["alpha", "--path"]);
    expect(output).toHaveBeenCalledWith("/install/docs/alpha.md\n");
  });
  it("preserves the original missing-doc diagnostic in a typed operation error", async () => {
    await expect(run(resolver, ["missing"])).rejects.toMatchObject({
      name: "OperationCliError",
      operationId: "doc",
      operationErrorName: "DocNotFoundError",
      message: 'Unknown doc "missing" — available: alpha',
    } satisfies Partial<OperationCliError>);
  });
  it("rejects invalid ids before constructing the resolver", async () => {
    const getResolver = vi.fn(() => resolver);
    await expect(
      createDocCommand({ getResolver }).parseAsync(["../alpha"], { from: "user" }),
    ).rejects.toThrow(/Invalid doc/);
    expect(getResolver).not.toHaveBeenCalled();
  });
});
