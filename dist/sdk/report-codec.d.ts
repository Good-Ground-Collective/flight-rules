import { z } from "zod";
import { ImplementationReportSchema, VerificationReportSchema } from "../orchestration/implementation-loop.schema.js";
import { ReviewTriageReportSchema } from "../orchestration/review-triage.schema.js";
declare const ResearchReportSchema: z.ZodObject<{
    summary: z.ZodString;
    confidence: z.ZodEnum<{
        low: "low";
        high: "high";
        med: "med";
    }>;
    internal: z.ZodOptional<z.ZodObject<{
        files: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            why: z.ZodString;
        }, z.core.$strict>>;
        patterns: z.ZodArray<z.ZodString>;
        integrationPoints: z.ZodArray<z.ZodString>;
        risks: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    external: z.ZodOptional<z.ZodObject<{
        answer: z.ZodString;
        sources: z.ZodArray<z.ZodObject<{
            url: z.ZodURL;
            title: z.ZodString;
        }, z.core.$strict>>;
        exampleUsage: z.ZodNullable<z.ZodString>;
        caveats: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
declare const QaReproduceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    summary: z.ZodString;
    reproduced: z.ZodLiteral<true>;
    needs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    steps: z.ZodArray<z.ZodString>;
    after: z.ZodArray<z.ZodString>;
    rootCause: z.ZodString;
    trapForQA: z.ZodString;
    fixedWhen: z.ZodArray<z.ZodString>;
    evidence: z.ZodObject<{
        dir: z.ZodString;
        items: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                text: "text";
                image: "image";
                video: "video";
            }>;
            phase: z.ZodEnum<{
                before: "before";
                after: "after";
            }>;
            caption: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>, z.ZodObject<{
    summary: z.ZodString;
    reproduced: z.ZodLiteral<false>;
    reason: z.ZodString;
    needs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    evidence: z.ZodObject<{
        dir: z.ZodString;
        items: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                text: "text";
                image: "image";
                video: "video";
            }>;
            phase: z.ZodEnum<{
                before: "before";
                after: "after";
            }>;
            caption: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>], "reproduced">;
declare const QaVerifySchema: z.ZodObject<{
    summary: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        verdict: z.ZodEnum<{
            UNVERIFIABLE: "UNVERIFIABLE";
            PASS: "PASS";
            FAIL: "FAIL";
        }>;
        evidence: z.ZodString;
    }, z.core.$strict>>;
    evidence: z.ZodObject<{
        dir: z.ZodString;
        items: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            kind: z.ZodEnum<{
                text: "text";
                image: "image";
                video: "video";
            }>;
            phase: z.ZodEnum<{
                before: "before";
                after: "after";
            }>;
            caption: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    verified: z.ZodBoolean;
    needs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const WriterFeedbackSchema: z.ZodObject<{
    summary: z.ZodString;
    verdict: z.ZodEnum<{
        CLEAN: "CLEAN";
        MINOR: "MINOR";
        HEAVY: "HEAVY";
    }>;
    findings: z.ZodArray<z.ZodObject<{
        excerpt: z.ZodString;
        location: z.ZodString;
        mandate: z.ZodString;
        problem: z.ZodString;
        suggestion: z.ZodString;
    }, z.core.$strict>>;
    strengths: z.ZodArray<z.ZodString>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const WriterRewriteSchema: z.ZodObject<{
    summary: z.ZodString;
    verdict: z.ZodEnum<{
        CLEAN: "CLEAN";
        MINOR: "MINOR";
        HEAVY: "HEAVY";
    }>;
    changes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        before: z.ZodString;
        after: z.ZodString;
        mandate: z.ZodString;
        why: z.ZodString;
    }, z.core.$strict>>>;
    rewritten: z.ZodOptional<z.ZodString>;
    preserved: z.ZodArray<z.ZodString>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const WriterAuthorSchema: z.ZodObject<{
    summary: z.ZodString;
    whatWasChanged: z.ZodArray<z.ZodString>;
    whyWasItChanged: z.ZodString;
    otsMaterials: z.ZodString;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const ReportModeSchema: z.ZodUnion<readonly [z.ZodObject<{
    agent: z.ZodLiteral<"code-implementation">;
    mode: z.ZodLiteral<"implement">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"code-implementation-escalated">;
    mode: z.ZodLiteral<"implement">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"code-verifier">;
    mode: z.ZodLiteral<"verify">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"code-verifier">;
    mode: z.ZodLiteral<"triage">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"research-agent">;
    mode: z.ZodEnum<{
        external: "external";
        internal: "internal";
        mixed: "mixed";
    }>;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"qa-engineer">;
    mode: z.ZodLiteral<"reproduce">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"qa-engineer">;
    mode: z.ZodLiteral<"verify">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"qa-engineer-verify">;
    mode: z.ZodLiteral<"verify">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"tech-writer">;
    mode: z.ZodLiteral<"feedback">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"tech-writer">;
    mode: z.ZodLiteral<"rewrite">;
}, z.core.$strict>, z.ZodObject<{
    agent: z.ZodLiteral<"tech-writer">;
    mode: z.ZodLiteral<"author">;
}, z.core.$strict>]>;
export type ReportMode = z.infer<typeof ReportModeSchema>;
export type ValidatedWorkerReport = z.infer<typeof ImplementationReportSchema> | z.infer<typeof VerificationReportSchema> | z.infer<typeof ReviewTriageReportSchema> | z.infer<typeof ResearchReportSchema> | z.infer<typeof QaReproduceSchema> | z.infer<typeof QaVerifySchema> | z.infer<typeof WriterFeedbackSchema> | z.infer<typeof WriterRewriteSchema> | z.infer<typeof WriterAuthorSchema>;
export declare class InvalidWorkerReportError extends Error {
    name: string;
}
export interface WorkerReportParser {
    parse(input: string, requested: ReportMode): ValidatedWorkerReport;
}
/** Validates the worker's final YAML report against the registration's requested report shape. */
export declare class WorkerReportCodec implements WorkerReportParser {
    parse(input: string, requested: ReportMode): ValidatedWorkerReport;
    private pipelineFor;
    private schemaFor;
}
export declare const workerReportCodec: WorkerReportParser;
export {};
