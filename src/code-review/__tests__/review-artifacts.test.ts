import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reviewContract } from "../review-contract.js";
import { FileReviewPolicy } from "../review-policy.js";

const root = join(import.meta.dirname, "..", "..", "..");
describe("shared review artifacts", () => {
  it("generated schemas agree with the canonical source, including ordinary apostrophes", () => {
    const schemas = reviewContract.schemas();
    expect(
      JSON.parse(readFileSync(join(root, "contracts/code-review/review.v1.schema.json"), "utf8")),
    ).toEqual(schemas.full);
    expect(
      JSON.parse(
        readFileSync(join(root, "contracts/code-review/review.v1.transport.schema.json"), "utf8"),
      ),
    ).toEqual(schemas.transport);
    expect(schemas.transport).toHaveProperty("additionalProperties", false);
  });
  it("loads the shared method and charter from the installed review entry point", async () => {
    const installed = await import(join(root, "dist/review.js"));
    const policy = new installed.FileReviewPolicy().load();
    expect(policy).toEqual(new FileReviewPolicy({ home: root }).load());
    expect(policy.method).toContain("fix, clarify and decide");
    expect(policy.contract).toContain("code-review:finding");
  });
});
