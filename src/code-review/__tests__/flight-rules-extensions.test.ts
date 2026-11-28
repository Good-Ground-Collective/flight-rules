import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  FileCoverageSchema,
  FlightRulesExtensionSchema,
  FlightRulesExtensions,
  MandateCoverageSchema,
} from "../flight-rules-extensions.js";
import { reviewContract } from "../review-contract.js";

const extension = (overrides: Record<string, unknown> = {}) => ({
  charterCoverage: {
    charters: ["core"],
    mandates: [
      { id: "M-1", charter: "core", state: "reviewed", files: ["a.ts"] },
    ],
  },
  lint: { status: "absent", detail: "No linter runs." },
  counts: { tierA: 0, tierB: 0, holistic: 0 },
  ...overrides,
});
const review = (flightRules: unknown = extension(), complete = true) => ({
  review_complete: complete,
  ...(complete ? {} : { incomplete_reason: "ran out of budget" }),
  extensions: flightRules === undefined ? {} : { flight_rules: flightRules },
});
const noExtension = () => ({ review_complete: true, extensions: {} });
const policy = new FlightRulesExtensions();
const check = (
  r: ReturnType<typeof review>,
  tierA = ["M-1"],
  charters = ["core"],
) => policy.problems({ review: r, tierA, charters });

describe("schemas", () => {
  it("accepts the full vocabulary and optional coverage", () => {
    expect(FlightRulesExtensionSchema.safeParse(extension()).success).toBe(
      true,
    );
    for (const state of ["enforced", "waived", "reviewed", "not_applicable"])
      expect(
        MandateCoverageSchema.safeParse({
          id: "M-1",
          charter: "core",
          state,
          files: [],
        }).success,
      ).toBe(true);
    for (const status of ["absent", "ran", "failed"])
      expect(
        FlightRulesExtensionSchema.safeParse(
          extension({ lint: { status, detail: "x" } }),
        ).success,
      ).toBe(true);
    expect(
      FlightRulesExtensionSchema.safeParse(
        extension({
          coverage: {
            files: [{ path: "a.ts", state: "reviewed", hunks_reviewed: 2 }],
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects invalid extensions and files", () => {
    expect(
      FlightRulesExtensionSchema.safeParse(extension({ extra: 1 })).success,
    ).toBe(false);
    expect(
      FlightRulesExtensionSchema.safeParse(
        extension({ lint: { status: "x", detail: "d" } }),
      ).success,
    ).toBe(false);
    expect(
      FileCoverageSchema.safeParse({ path: "a.ts", state: "bogus" }).success,
    ).toBe(false);
    expect(
      FileCoverageSchema.safeParse({ path: "/abs.ts", state: "reviewed" })
        .success,
    ).toBe(false);
    expect(
      FileCoverageSchema.safeParse({
        path: "a.ts",
        state: "reviewed",
        hunks_reviewed: -1,
      }).success,
    ).toBe(false);
  });
});

describe("problems", () => {
  it("is empty for a complete valid extension", () => {
    expect(check(review())).toEqual([]);
  });

  it("reports an incomplete review, with and without a reason", () => {
    expect(check(review(extension(), false))).toEqual([
      "the reviewer reported an incomplete review: ran out of budget",
    ]);
    expect(
      check({
        review_complete: false,
        extensions: { flight_rules: extension() },
      }),
    ).toEqual(["the reviewer reported an incomplete review: no reason given"]);
  });

  it("reports a missing or invalid extension", () => {
    expect(check(noExtension())[0]).toMatch(
      /^extensions\.flight_rules is missing or invalid: /,
    );
    expect(check(review({ nope: true }))).toHaveLength(1);
  });

  it("reports omitted charters and Tier A mandates", () => {
    expect(
      check(review(), ["M-1", "M-2", "M-3"], ["core", "typescript"]),
    ).toEqual([
      "charter coverage omits typescript",
      "Tier A coverage omits M-2, M-3",
    ]);
  });

  it("restricts mandate states and lint statuses", () => {
    const enforced = extension({
      charterCoverage: {
        charters: ["core"],
        mandates: [
          { id: "M-1", charter: "core", state: "enforced", files: [] },
        ],
      },
      lint: { status: "ran", detail: "eslint" },
    });
    const problems = policy.problems({
      review: review(enforced),
      tierA: ["M-1"],
      charters: ["core"],
      options: {
        lintStatuses: ["absent"],
        mandateStates: ["reviewed", "waived", "not_applicable"],
      },
    });
    expect(problems).toEqual([
      "lint status ran is not allowed",
      "mandate state is not allowed for M-1 (enforced)",
    ]);
    expect(check(review(enforced))).toEqual([]);
    const constructed = new FlightRulesExtensions({ lintStatuses: ["absent"] });
    expect(
      constructed.problems({
        review: review(enforced),
        tierA: [],
        charters: [],
      }),
    ).toEqual(["lint status ran is not allowed"]);
  });
});

describe("fileCoverageProblems", () => {
  const withFiles = (paths: string[]) =>
    review(
      extension({
        coverage: { files: paths.map((path) => ({ path, state: "reviewed" })) },
      }),
    );

  it("is empty when every changed path is covered", () => {
    expect(
      policy.fileCoverageProblems({
        review: withFiles(["a.ts", "b.ts"]),
        changedPaths: ["a.ts", "b.ts"],
      }),
    ).toEqual([]);
  });

  it("reports omitted changed paths, including when coverage is absent", () => {
    expect(
      policy.fileCoverageProblems({
        review: withFiles(["a.ts"]),
        changedPaths: ["a.ts", "b.ts", "c.ts"],
      }),
    ).toEqual(["file coverage omits b.ts, c.ts"]);
    expect(
      policy.fileCoverageProblems({ review: review(), changedPaths: ["a.ts"] }),
    ).toEqual(["file coverage omits a.ts"]);
  });

  it("reports duplicate paths once each", () => {
    expect(
      policy.fileCoverageProblems({
        review: withFiles(["a.ts", "a.ts", "a.ts"]),
        changedPaths: ["a.ts"],
      }),
    ).toEqual(["file coverage lists a.ts twice"]);
  });

  it("does not require deleted files and uses the new path for renames", () => {
    expect(
      policy.fileCoverageProblems({
        review: withFiles(["new.ts"]),
        changedPaths: ["new.ts"],
      }),
    ).toEqual([]);
  });

  it("returns early when the extension is missing or invalid", () => {
    expect(
      policy.fileCoverageProblems({
        review: noExtension(),
        changedPaths: ["a.ts"],
      }),
    ).toEqual([]);
    expect(
      policy.fileCoverageProblems({
        review: review({ bad: 1 }),
        changedPaths: ["a.ts"],
      }),
    ).toEqual([]);
  });
});

describe("withExtension", () => {
  const { transport } = reviewContract.schemas();
  const splicedSchema = z.object({
    properties: z.object({
      extensions: z.object({
        required: z.array(z.string()),
        additionalProperties: z.boolean(),
        properties: z.object({
          flight_rules: z.looseObject({
            $schema: z.string().optional(),
            required: z.array(z.string()),
            properties: z.record(z.string(), z.any()),
          }),
        }),
      }),
    }),
  });
  const extensionOf = (schema: Record<string, unknown>) =>
    splicedSchema.parse(schema).properties.extensions;
  const flightRules = (schema: Record<string, unknown>) =>
    extensionOf(schema).properties.flight_rules;

  it("splices a required, closed extensions property without mutating the input", () => {
    const before = JSON.stringify(transport);
    const out = policy.withExtension(transport);
    expect(JSON.stringify(transport)).toBe(before);
    expect(out.required).toContain("extensions");
    const extensions = extensionOf(out);
    expect(extensions.required).toEqual(["flight_rules"]);
    expect(extensions.additionalProperties).toBe(false);
    expect(flightRules(out).$schema).toBeUndefined();
    expect(flightRules(out).properties.coverage).toBeDefined();
    expect(flightRules(out).required).not.toContain("coverage");
    expect(out.$schema).toBe(transport.$schema);
    expect(out).not.toBe(transport);
  });

  it("restricts lint statuses and mandate states", () => {
    const out = policy.withExtension(transport, {
      lintStatuses: ["absent"],
      mandateStates: ["reviewed", "waived", "not_applicable"],
    });
    const fr = flightRules(out);
    expect(fr.properties.lint.properties.status.enum).toEqual(["absent"]);
    expect(
      fr.properties.charterCoverage.properties.mandates.items.properties.state
        .enum,
    ).toEqual(["reviewed", "waived", "not_applicable"]);
  });

  it("keeps all states by default and rejects a malformed transport schema", () => {
    const fr = flightRules(policy.withExtension(transport));
    expect(fr.properties.lint.properties.status.enum).toEqual([
      "absent",
      "ran",
      "failed",
    ]);
    expect(() => policy.withExtension({ nope: 1 })).toThrow();
  });
});
