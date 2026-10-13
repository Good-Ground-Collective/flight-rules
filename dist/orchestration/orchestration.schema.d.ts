import { z } from "zod";
export declare const OrchestrationTextSchema: z.ZodString;
/** Context identifies the active checkout, including a linked worktree, rather than a user's main checkout. */
export declare const RunContextSchema: z.ZodObject<{
    runId: z.ZodString;
    taskId: z.ZodString;
    cwd: z.ZodString;
    repositoryRoot: z.ZodString;
    baseRef: z.ZodString;
    skill: z.ZodString;
}, z.core.$strict>;
export declare const CallerContextSchema: z.ZodObject<{
    runId: z.ZodString;
    taskId: z.ZodString;
    cwd: z.ZodString;
    repositoryRoot: z.ZodString;
    baseRef: z.ZodString;
    skill: z.ZodString;
    attempt: z.ZodInt;
}, z.core.$strict>;
/** Evidence describes observed access; parsing it cannot authenticate the observation or grant access. */
export declare const CapabilityEvidenceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    state: z.ZodLiteral<"available">;
    evidence: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    state: z.ZodEnum<{
        unknown: "unknown";
        denied: "denied";
    }>;
    evidence: z.ZodString;
    remedy: z.ZodString;
}, z.core.$strict>], "state">;
export declare const AdapterLimitsSchema: z.ZodObject<{
    maxConcurrent: z.ZodNullable<z.ZodInt>;
    activeWorkers: z.ZodInt;
    currentDepth: z.ZodInt;
    maxDepth: z.ZodNullable<z.ZodInt>;
    source: z.ZodString;
}, z.core.$strict>;
export declare const RuntimeSnapshotSchema: z.ZodObject<{
    context: z.ZodObject<{
        runId: z.ZodString;
        taskId: z.ZodString;
        cwd: z.ZodString;
        repositoryRoot: z.ZodString;
        baseRef: z.ZodString;
        skill: z.ZodString;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    host: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, z.core.$strict>;
    observedAt: z.ZodISODateTime;
    agent: z.ZodNullable<z.ZodString>;
    spawn: z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"available">;
        evidence: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodEnum<{
            unknown: "unknown";
            denied: "denied";
        }>;
        evidence: z.ZodString;
        remedy: z.ZodString;
    }, z.core.$strict>], "state">;
    ask: z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"available">;
        evidence: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodEnum<{
            unknown: "unknown";
            denied: "denied";
        }>;
        evidence: z.ZodString;
        remedy: z.ZodString;
    }, z.core.$strict>], "state">;
    permissions: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"available">;
        evidence: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodEnum<{
            unknown: "unknown";
            denied: "denied";
        }>;
        evidence: z.ZodString;
        remedy: z.ZodString;
    }, z.core.$strict>], "state">>;
    limits: z.ZodObject<{
        maxConcurrent: z.ZodNullable<z.ZodInt>;
        activeWorkers: z.ZodInt;
        currentDepth: z.ZodInt;
        maxDepth: z.ZodNullable<z.ZodInt>;
        source: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const DispatchRequestSchema: z.ZodObject<{
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
export declare const OrchestrationFailureSchema: z.ZodObject<{
    code: z.ZodEnum<{
        UNKNOWN_AGENT: "UNKNOWN_AGENT";
        UNSUPPORTED_AGENT_SETTINGS: "UNSUPPORTED_AGENT_SETTINGS";
        CONTEXT_MISMATCH: "CONTEXT_MISMATCH";
        CAPABILITY_DENIED: "CAPABILITY_DENIED";
        CAPABILITY_UNKNOWN: "CAPABILITY_UNKNOWN";
        DISPATCH_UNAVAILABLE: "DISPATCH_UNAVAILABLE";
        LIMITS_UNKNOWN: "LIMITS_UNKNOWN";
        CAPACITY_EXHAUSTED: "CAPACITY_EXHAUSTED";
        DEPTH_EXCEEDED: "DEPTH_EXCEEDED";
        QUESTIONS_DISABLED: "QUESTIONS_DISABLED";
        QUESTIONS_UNAVAILABLE: "QUESTIONS_UNAVAILABLE";
        INVALID_HANDOFF: "INVALID_HANDOFF";
        INVALID_REPORT: "INVALID_REPORT";
        INVALID_HISTORY: "INVALID_HISTORY";
        OPEN_QUESTIONS: "OPEN_QUESTIONS";
        UNVERIFIABLE: "UNVERIFIABLE";
        ATTEMPTS_EXHAUSTED: "ATTEMPTS_EXHAUSTED";
        EXECUTION_FAILED: "EXECUTION_FAILED";
        CANCELLED: "CANCELLED";
    }>;
    message: z.ZodString;
    remedy: z.ZodString;
    capability: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const DispatchOutcomeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    dispatchId: z.ZodString;
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
    status: z.ZodLiteral<"completed">;
    report: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>, z.ZodObject<{
    dispatchId: z.ZodString;
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
    status: z.ZodEnum<{
        failed: "failed";
        unavailable: "unavailable";
    }>;
    failure: z.ZodObject<{
        code: z.ZodEnum<{
            UNKNOWN_AGENT: "UNKNOWN_AGENT";
            UNSUPPORTED_AGENT_SETTINGS: "UNSUPPORTED_AGENT_SETTINGS";
            CONTEXT_MISMATCH: "CONTEXT_MISMATCH";
            CAPABILITY_DENIED: "CAPABILITY_DENIED";
            CAPABILITY_UNKNOWN: "CAPABILITY_UNKNOWN";
            DISPATCH_UNAVAILABLE: "DISPATCH_UNAVAILABLE";
            LIMITS_UNKNOWN: "LIMITS_UNKNOWN";
            CAPACITY_EXHAUSTED: "CAPACITY_EXHAUSTED";
            DEPTH_EXCEEDED: "DEPTH_EXCEEDED";
            QUESTIONS_DISABLED: "QUESTIONS_DISABLED";
            QUESTIONS_UNAVAILABLE: "QUESTIONS_UNAVAILABLE";
            INVALID_HANDOFF: "INVALID_HANDOFF";
            INVALID_REPORT: "INVALID_REPORT";
            INVALID_HISTORY: "INVALID_HISTORY";
            OPEN_QUESTIONS: "OPEN_QUESTIONS";
            UNVERIFIABLE: "UNVERIFIABLE";
            ATTEMPTS_EXHAUSTED: "ATTEMPTS_EXHAUSTED";
            EXECUTION_FAILED: "EXECUTION_FAILED";
            CANCELLED: "CANCELLED";
        }>;
        message: z.ZodString;
        remedy: z.ZodString;
        capability: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "status">;
export declare const QuestionRequestSchema: z.ZodObject<{
    context: z.ZodObject<{
        runId: z.ZodString;
        taskId: z.ZodString;
        cwd: z.ZodString;
        repositoryRoot: z.ZodString;
        baseRef: z.ZodString;
        skill: z.ZodString;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    question: z.ZodString;
    allowHumanQuestions: z.ZodBoolean;
}, z.core.$strict>;
export declare const SiblingSkillRequestSchema: z.ZodObject<{
    context: z.ZodObject<{
        runId: z.ZodString;
        taskId: z.ZodString;
        cwd: z.ZodString;
        repositoryRoot: z.ZodString;
        baseRef: z.ZodString;
        skill: z.ZodString;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    skill: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export type RunContext = z.infer<typeof RunContextSchema>;
export type CallerContext = z.infer<typeof CallerContextSchema>;
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;
export type AdapterLimits = z.infer<typeof AdapterLimitsSchema>;
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;
export type OrchestrationFailure = z.infer<typeof OrchestrationFailureSchema>;
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;
export type SiblingSkillRequest = z.infer<typeof SiblingSkillRequestSchema>;
export type DispatchOutcome<T> = {
    status: "completed";
    dispatchId: string;
    agent: string;
    context: CallerContext;
    report: T;
} | {
    status: "failed" | "unavailable";
    dispatchId: string;
    agent: string;
    context: CallerContext;
    failure: OrchestrationFailure;
};
