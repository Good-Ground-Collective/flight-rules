import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const executeWork = readFileSync(join(root, "skills", "execute-work", "SKILL.md"), "utf8");
const remediateReview = readFileSync(join(root, "skills", "remediate-review", "SKILL.md"), "utf8");
const doc = readFileSync(join(root, "docs", "review-remediation.md"), "utf8");

describe("review remediation doc", () => {
  it("is loaded by execute-work", () => {
    expect(executeWork).toContain("flight-rules doc review-remediation");
  });

  it("is loaded by remediate-review", () => {
    expect(remediateReview).toContain("flight-rules doc review-remediation");
  });

  it.each([
    "formatted `[review:<id>] <criterion>`",
    "Dispatch a fresh `code-verifier` with `mode: triage`",
    "Maximum three remediation attempts",
    "Reconcile the current PR head before pushing",
  ])('keeps "%s" out of execute-work and in the doc', (sentence) => {
    expect(executeWork).not.toContain(sentence);
    expect(doc).toContain(sentence);
  });

  it("names the thread commands and the caller-specific points", () => {
    expect(doc).toContain("flight-rules pr threads <number> --trusted-author");
    expect(doc).toContain("flight-rules pr thread-reply <thread-id> --body-file");
    expect(doc).toContain("## Caller-specific");
  });
});
