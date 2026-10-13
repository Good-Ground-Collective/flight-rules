import { z } from "zod";
import type { ReadinessCheck } from "./readiness.schema.js";

const ProbeDiagnosticsPropsSchema = z.object({ env: z.record(z.string(), z.string().optional()) });
const ErrorFactsSchema = z.object({
  code: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.number().optional(),
  statusCode: z.number().optional(),
  killed: z.boolean().optional(),
  name: z.string().optional(),
  message: z.string().optional(),
  stderr: z.string().optional(),
  cause: z.unknown().optional(),
});
export interface ProbeDiagnostics {
  redact(text: string): string;
  failure(name: string, error: unknown, required: boolean, fallback?: string): ReadinessCheck;
}

/** Keeps observed failure categories separate and removes credentials before diagnostics leave the process. */
export class RedactedProbeDiagnostics implements ProbeDiagnostics {
  private readonly secrets: string[];

  constructor(props: z.infer<typeof ProbeDiagnosticsPropsSchema>) {
    const { env } = ProbeDiagnosticsPropsSchema.parse({
      ...props,
      env: props.env === undefined ? undefined : { ...props.env },
    });
    this.secrets = Object.entries(env)
      .filter(
        ([key, value]) =>
          /token|secret|password|api[_-]?key|credential/i.test(key) && Boolean(value),
      )
      .flatMap(([, value]) => (value === undefined ? [] : [value, encodeURIComponent(value)]))
      .sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    let result = text
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(/\b(Bearer|Basic)\s+[^\s,'";]+/gi, "$1 [REDACTED]")
      .replace(/([?&](?:token|access_token|api_key|key|signature)=)[^&#\s]+/gi, "$1[REDACTED]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]");
    for (const secret of this.secrets) result = result.replaceAll(secret, "[REDACTED]");
    return result;
  }

  failure(name: string, error: unknown, required: boolean, fallback = "UNKNOWN"): ReadinessCheck {
    const parsed = ErrorFactsSchema.safeParse(error);
    const facts = parsed.success ? parsed.data : {};
    const cause = ErrorFactsSchema.safeParse(facts.cause);
    const code = facts.code ?? (cause.success ? cause.data.code : undefined);
    const status = facts.status ?? facts.statusCode;
    const raw = facts.stderr?.trim() || facts.message || String(error);
    let category = fallback;
    if (code === "ENOENT")
      category = name.startsWith("local:") ? "PATH_UNAVAILABLE" : "MISSING_TOOL";
    else if (
      facts.killed ||
      facts.name === "TimeoutError" ||
      code === "ETIMEDOUT" ||
      /timed? out/i.test(raw)
    )
      category = "TIMEOUT";
    else if (
      status === 401 ||
      /HTTP 401|bad credentials|authentication failed|not logged in|could not read Username|Permission denied \(publickey\)/i.test(
        raw,
      )
    )
      category = "AUTHENTICATION";
    else if (
      code === "EACCES" ||
      code === "EPERM" ||
      status === 403 ||
      /HTTP 403|operation not permitted|permission denied|sandbox.*denied/i.test(raw)
    )
      category = "PERMISSION_DENIED";
    else if (
      ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(String(code)) ||
      (status !== undefined && status >= 500) ||
      /connection refused|could not resolve|network is unreachable|failed to connect|fetch failed|HTTP 5\d\d/i.test(
        raw,
      )
    )
      category = "NETWORK";
    const remedies: Record<string, string> = {
      MISSING_TOOL: "Install the missing executable and make it available on this invocation PATH.",
      PATH_UNAVAILABLE:
        "Resolve the intended existing filesystem path before relying on write access.",
      TIMEOUT:
        "Check service connectivity or a stalled credential helper, then rerun the bounded probe.",
      AUTHENTICATION:
        "Authenticate the relevant account through its supported login or credential setup, then rerun.",
      PERMISSION_DENIED:
        "Inspect the named account or host policy denial and use its normal scoped approval/setup path.",
      NETWORK:
        "Check DNS, routing and service availability. A connection failure alone does not establish sandbox denial.",
      UNKNOWN: "Inspect the operation and establish the missing capability before relying on it.",
    };
    return {
      name,
      ok: false,
      required,
      code: category,
      detail: category === "MISSING_TOOL" ? "not installed" : this.redact(raw),
      remedy: remedies[category] ?? remedies.UNKNOWN,
    };
  }
}
