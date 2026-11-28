import { z } from "zod";
import { ReviewPathSchema } from "./review.schema.js";

const mandateStates = [
  "enforced",
  "waived",
  "reviewed",
  "not_applicable",
] as const;
const lintStatuses = ["absent", "ran", "failed"] as const;
const fileStates = [
  "reviewed",
  "skipped_generated",
  "skipped_binary",
  "not_applicable",
] as const;

export const MandateStateSchema = z.enum(mandateStates);
export const LintStatusSchema = z.enum(lintStatuses);
export type MandateState = z.infer<typeof MandateStateSchema>;
export type LintStatus = z.infer<typeof LintStatusSchema>;

export const MandateCoverageSchema = z.strictObject({
  id: z.string().min(1),
  charter: z.string().min(1),
  state: MandateStateSchema,
  files: z.array(z.string()),
  note: z.string().max(2000).optional(),
});

/**
 * One changed file the reviewer accounted for. Deleted files need no entry; a renamed file is
 * listed under its new path, which is what the reviewer can read at the head.
 */
export const FileCoverageSchema = z.strictObject({
  path: ReviewPathSchema,
  state: z.enum(fileStates),
  hunks_reviewed: z.number().int().min(0).optional(),
  note: z.string().max(2000).optional(),
});

export const FlightRulesExtensionSchema = z.strictObject({
  charterCoverage: z.strictObject({
    charters: z.array(z.string().min(1)).min(1),
    mandates: z.array(MandateCoverageSchema),
  }),
  coverage: z.strictObject({ files: z.array(FileCoverageSchema) }).optional(),
  lint: z.strictObject({
    status: LintStatusSchema,
    detail: z.string().min(1).max(2000),
  }),
  counts: z.strictObject({
    tierA: z.number().int().min(0),
    tierB: z.number().int().min(0),
    holistic: z.number().int().min(0),
  }),
});
export type MandateCoverage = z.infer<typeof MandateCoverageSchema>;
export type FileCoverage = z.infer<typeof FileCoverageSchema>;
export type FlightRulesExtension = z.infer<typeof FlightRulesExtensionSchema>;

const OptionsSchema = z.strictObject({
  lintStatuses: z.array(LintStatusSchema).min(1).optional(),
  mandateStates: z.array(MandateStateSchema).min(1).optional(),
});
export type FlightRulesExtensionOptions = z.input<typeof OptionsSchema>;

const ReviewLikeSchema = z.object({
  review_complete: z.boolean(),
  incomplete_reason: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
const ProblemsInputSchema = z.object({
  review: ReviewLikeSchema,
  tierA: z.array(z.string()),
  charters: z.array(z.string()),
  options: OptionsSchema.optional(),
});
const FileCoverageInputSchema = z.object({
  review: ReviewLikeSchema,
  changedPaths: z.array(ReviewPathSchema),
});
const TransportSchemaSchema = z.looseObject({
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()),
});

export interface ReviewExtensionPolicy {
  /** Problems that make a pass INCOMPLETE: an incomplete review, or a missing or invalid extension. */
  problems(input: {
    review: z.input<typeof ReviewLikeSchema>;
    tierA: string[];
    charters: string[];
    options?: FlightRulesExtensionOptions;
  }): string[];
  /** Changed paths the reviewer did not account for in `coverage.files`, and duplicate entries. */
  fileCoverageProblems(input: {
    review: z.input<typeof ReviewLikeSchema>;
    changedPaths: string[];
  }): string[];
  /** A new draft-07 transport schema with `extensions.flight_rules` required. */
  withExtension(
    transportSchema: unknown,
    options?: FlightRulesExtensionOptions,
  ): Record<string, unknown>;
}

/** The `extensions.flight_rules` review extension: its schema, its problems check and the schema splice. */
export class FlightRulesExtensions implements ReviewExtensionPolicy {
  private readonly defaults: z.output<typeof OptionsSchema>;

  constructor(props: FlightRulesExtensionOptions = {}) {
    this.defaults = OptionsSchema.parse(props);
  }

  problems(input: Parameters<ReviewExtensionPolicy["problems"]>[0]): string[] {
    const { review, tierA, charters, options } =
      ProblemsInputSchema.parse(input);
    const problems: string[] = [];
    if (!review.review_complete)
      problems.push(
        `the reviewer reported an incomplete review: ${review.incomplete_reason || "no reason given"}`,
      );
    const parsed = FlightRulesExtensionSchema.safeParse(
      review.extensions?.flight_rules,
    );
    if (!parsed.success) {
      problems.push(
        `extensions.flight_rules is missing or invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
      return problems;
    }
    const { lintStatuses: lint, mandateStates: states } = this.resolve(options);
    const extension = parsed.data;
    if (!lint.includes(extension.lint.status))
      problems.push(`lint status ${extension.lint.status} is not allowed`);
    const disallowed = extension.charterCoverage.mandates.filter(
      (mandate) => !states.includes(mandate.state),
    );
    if (disallowed.length > 0)
      problems.push(
        `mandate state is not allowed for ${disallowed.map((mandate) => `${mandate.id} (${mandate.state})`).join(", ")}`,
      );
    const coverage = extension.charterCoverage;
    const missingCharters = charters.filter(
      (id) => !coverage.charters.includes(id),
    );
    if (missingCharters.length > 0)
      problems.push(`charter coverage omits ${missingCharters.join(", ")}`);
    const accounted = new Set(coverage.mandates.map((mandate) => mandate.id));
    const missing = tierA.filter((id) => !accounted.has(id));
    if (missing.length > 0)
      problems.push(`Tier A coverage omits ${missing.join(", ")}`);
    return problems;
  }

  fileCoverageProblems(
    input: Parameters<ReviewExtensionPolicy["fileCoverageProblems"]>[0],
  ): string[] {
    const { review, changedPaths } = FileCoverageInputSchema.parse(input);
    const parsed = FlightRulesExtensionSchema.safeParse(
      review.extensions?.flight_rules,
    );
    if (!parsed.success) return [];
    const listed = (parsed.data.coverage?.files ?? []).map((file) => file.path);
    const problems: string[] = [];
    const accounted = new Set(listed);
    const missing = [...new Set(changedPaths)].filter(
      (path) => !accounted.has(path),
    );
    if (missing.length > 0)
      problems.push(`file coverage omits ${missing.join(", ")}`);
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const path of listed) {
      if (seen.has(path) && !duplicated.has(path)) {
        duplicated.add(path);
        problems.push(`file coverage lists ${path} twice`);
      }
      seen.add(path);
    }
    return problems;
  }

  withExtension(
    transportSchema: unknown,
    options?: FlightRulesExtensionOptions,
  ): Record<string, unknown> {
    const transport = structuredClone(
      TransportSchemaSchema.parse(transportSchema),
    );
    const { lintStatuses: lint, mandateStates: states } = this.resolve(
      OptionsSchema.parse(options ?? {}),
    );
    const restricted = FlightRulesExtensionSchema.extend({
      charterCoverage: z.strictObject({
        charters: z.array(z.string().min(1)).min(1),
        mandates: z.array(
          MandateCoverageSchema.extend({ state: z.enum(states) }),
        ),
      }),
      lint: z.strictObject({
        status: z.enum(lint),
        detail: z.string().min(1).max(2000),
      }),
    });
    const extension: Record<string, unknown> = {
      ...z.toJSONSchema(restricted, { target: "draft-07" }),
    };
    delete extension.$schema;
    return {
      ...transport,
      properties: {
        ...transport.properties,
        extensions: {
          type: "object",
          properties: { flight_rules: extension },
          required: ["flight_rules"],
          additionalProperties: false,
        },
      },
      required: [...new Set([...transport.required, "extensions"])],
    };
  }

  private resolve(options: z.output<typeof OptionsSchema> | undefined): {
    lintStatuses: LintStatus[];
    mandateStates: MandateState[];
  } {
    return {
      lintStatuses: options?.lintStatuses ??
        this.defaults.lintStatuses ?? [...lintStatuses],
      mandateStates: options?.mandateStates ??
        this.defaults.mandateStates ?? [...mandateStates],
    };
  }
}
