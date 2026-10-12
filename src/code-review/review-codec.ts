import { createHash } from "node:crypto";
import { z } from "zod";
import { reviewContract, InvalidReviewError } from "./review-contract.js";
import type { FindingRecord, ReviewState, StoredFinding } from "./review.schema.js";

export interface ReviewCodec {
  finding(record: FindingRecord): string;
  state(state: ReviewState): string;
  readFindings(input: {
    body: string;
    authorId: number;
    trustedAuthorIds: number[];
  }): FindingRecord[];
  readState(input: {
    body: string;
    authorId: number;
    trustedAuthorIds: number[];
  }): ReviewState | undefined;
  render(record: FindingRecord): string;
  fingerprint(finding: StoredFinding): string;
}
const MarkerInputSchema = z.strictObject({
  body: z.string(),
  authorId: z.number().int().positive(),
  trustedAuthorIds: z.array(z.number().int().positive()),
});

/** Full markers preserve actionable state independently of GitHub thread resolution or rendered prose. */
export class JsonReviewCodec implements ReviewCodec {
  finding(record: FindingRecord): string {
    return this.marker("finding", reviewContract.record(record));
  }
  state(state: ReviewState): string {
    return this.marker("state", reviewContract.state(state));
  }

  readFindings(input: {
    body: string;
    authorId: number;
    trustedAuthorIds: number[];
  }): FindingRecord[] {
    const parsed = MarkerInputSchema.parse(input);
    if (!parsed.trustedAuthorIds.includes(parsed.authorId)) return [];
    return this.readMarkers(parsed.body, "finding").map((value) => reviewContract.record(value));
  }

  readState(input: {
    body: string;
    authorId: number;
    trustedAuthorIds: number[];
  }): ReviewState | undefined {
    const parsed = MarkerInputSchema.parse(input);
    if (!parsed.trustedAuthorIds.includes(parsed.authorId)) return undefined;
    const states = this.readMarkers(parsed.body, "state");
    if (states.length > 1)
      throw new InvalidReviewError("multiple review state markers in one summary");
    return states.length === 0 ? undefined : reviewContract.state(states[0]);
  }

  render(record: FindingRecord): string {
    const validated = reviewContract.record(record);
    const finding = validated.finding;
    const decorations = [
      ...(["nitpick", "typo", "polish"].includes(finding.label)
        ? []
        : [finding.blocking ? "blocking" : "non-blocking"]),
      finding.type,
    ];
    if (finding.category !== undefined) decorations.push(finding.category);
    const owner =
      finding.type === "decide"
        ? `\n\n**Decision owner:** ${finding.decision_owner}\n**Decision options:** ${finding.decision_options.map((option) => `\`${option.id}\`: ${option.description}`).join("; ")}`
        : "";
    return `**${finding.label} (${decorations.join(", ")}):** ${finding.subject}\n\n${finding.discussion}\n\n<details>\n<summary>Details For LLM</summary>\n\n${finding.details}${owner}\n\n**Resolved when:** ${finding.resolved_when}\n</details>\n\n${this.finding(validated)}`;
  }

  fingerprint(finding: StoredFinding): string {
    return createHash("sha256")
      .update(`${finding.path}|${finding.label}|${finding.subject.trim().toLowerCase()}`)
      .digest("hex");
  }

  private marker(kind: "finding" | "state", value: unknown): string {
    return `<!-- code-review:${kind} ${JSON.stringify(value).replaceAll(">", "\\u003e")} -->`;
  }

  private readMarkers(body: string, kind: "finding" | "state"): unknown[] {
    const prefix = `<!-- code-review:${kind} `;
    const matches = [...body.matchAll(new RegExp(`${prefix}([\\s\\S]*?) -->`, "g"))];
    if (body.split(prefix).length - 1 !== matches.length)
      throw new InvalidReviewError("unterminated review marker");
    return matches.map((match) => {
      try {
        return JSON.parse(match[1] ?? "");
      } catch {
        throw new InvalidReviewError(
          "review marker contains invalid JSON; recover state before approving",
        );
      }
    });
  }
}
