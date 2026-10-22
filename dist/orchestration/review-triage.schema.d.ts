import { z } from "zod";
export declare const ReviewTriageReportSchema: z.ZodObject<{
    summary: z.ZodString;
    headSha: z.ZodString;
    findings: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: z.ZodString;
        disposition: z.ZodLiteral<"fix">;
        evidence: z.ZodString;
        criterion: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        disposition: z.ZodLiteral<"ignore">;
        evidence: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        disposition: z.ZodLiteral<"needs_input">;
        evidence: z.ZodString;
        question: z.ZodString;
    }, z.core.$strict>], "disposition">>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type ReviewTriageReport = z.infer<typeof ReviewTriageReportSchema>;
