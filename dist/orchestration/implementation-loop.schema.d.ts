import { z } from "zod";
export declare const ImplementationReportSchema: z.ZodObject<{
    summary: z.ZodString;
    filesChanged: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        why: z.ZodString;
    }, z.core.$strict>>;
    testsRun: z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        result: z.ZodString;
    }, z.core.$strict>>;
    approach: z.ZodString;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const CriterionResultSchema: z.ZodObject<{
    criterion: z.ZodString;
    verdict: z.ZodEnum<{
        UNVERIFIABLE: "UNVERIFIABLE";
        PASS: "PASS";
        FAIL: "FAIL";
    }>;
    evidence: z.ZodString;
}, z.core.$strict>;
export declare const VerificationReportSchema: z.ZodObject<{
    summary: z.ZodString;
    criteria: z.ZodArray<z.ZodObject<{
        criterion: z.ZodString;
        verdict: z.ZodEnum<{
            UNVERIFIABLE: "UNVERIFIABLE";
            PASS: "PASS";
            FAIL: "FAIL";
        }>;
        evidence: z.ZodString;
    }, z.core.$strict>>;
    charterConcerns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    verified: z.ZodBoolean;
}, z.core.$strict>;
export declare const HandoffRecordSchema: z.ZodObject<{
    request: z.ZodObject<{
        id: z.ZodString;
        agent: z.ZodString;
        context: z.ZodObject<{
            runId: z.ZodString;
            taskId: z.ZodString;
            cwd: z.ZodString;
            repositoryRoot: z.ZodString;
            baseRef: z.ZodString;
            skill: z.ZodString;
            attempt: z.ZodInt;
        }, z.core.$strict>;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        requiredCapabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    outcome: z.ZodUnknown;
}, z.core.$strict>;
export declare const ImplementationRunSchema: z.ZodObject<{
    context: z.ZodObject<{
        runId: z.ZodString;
        taskId: z.ZodString;
        cwd: z.ZodString;
        repositoryRoot: z.ZodString;
        baseRef: z.ZodString;
        skill: z.ZodString;
    }, z.core.$strict>;
    criteria: z.ZodArray<z.ZodString>;
    implementationInput: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    history: z.ZodArray<z.ZodObject<{
        implementation: z.ZodObject<{
            request: z.ZodObject<{
                id: z.ZodString;
                agent: z.ZodString;
                context: z.ZodObject<{
                    runId: z.ZodString;
                    taskId: z.ZodString;
                    cwd: z.ZodString;
                    repositoryRoot: z.ZodString;
                    baseRef: z.ZodString;
                    skill: z.ZodString;
                    attempt: z.ZodInt;
                }, z.core.$strict>;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                requiredCapabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>;
            outcome: z.ZodUnknown;
        }, z.core.$strict>;
        verification: z.ZodObject<{
            request: z.ZodObject<{
                id: z.ZodString;
                agent: z.ZodString;
                context: z.ZodObject<{
                    runId: z.ZodString;
                    taskId: z.ZodString;
                    cwd: z.ZodString;
                    repositoryRoot: z.ZodString;
                    baseRef: z.ZodString;
                    skill: z.ZodString;
                    attempt: z.ZodInt;
                }, z.core.$strict>;
                input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
                requiredCapabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>;
            outcome: z.ZodUnknown;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ImplementationReport = z.infer<typeof ImplementationReportSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;
export type ImplementationRun = z.infer<typeof ImplementationRunSchema>;
