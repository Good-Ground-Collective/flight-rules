import { z } from "zod";
export declare const WorkflowSchema: z.ZodEnum<{
    "execute-work": "execute-work";
    "execute-wave": "execute-wave";
    "break-down-work": "break-down-work";
    "reproduce-bug": "reproduce-bug";
    "verify-ticket": "verify-ticket";
}>;
export declare const WorkflowEvidenceSchema: z.ZodObject<{
    context: z.ZodObject<{
        runId: z.ZodString;
        taskId: z.ZodString;
        cwd: z.ZodString;
        repositoryRoot: z.ZodString;
        baseRef: z.ZodString;
        skill: z.ZodString;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    callerCapabilities: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    workers: z.ZodArray<z.ZodObject<{
        registration: z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            capabilities: z.ZodArray<z.ZodEnum<{
                edit: "edit";
                read: "read";
                shell: "shell";
                web: "web";
                spawn: "spawn";
                ask: "ask";
            }>>;
            model: z.ZodEnum<{
                standard: "standard";
                escalated: "escalated";
                expert: "expert";
            }>;
            modelReason: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            sandbox: z.ZodOptional<z.ZodObject<{
                fs: z.ZodEnum<{
                    "read-only": "read-only";
                    "workspace-write": "workspace-write";
                }>;
                network: z.ZodEnum<{
                    enabled: "enabled";
                    none: "none";
                }>;
            }, z.core.$strict>>;
            dispatch: z.ZodOptional<z.ZodObject<{
                maxConcurrent: z.ZodInt;
                maxDepth: z.ZodInt;
            }, z.core.$strict>>;
            "x-claude": z.ZodOptional<z.ZodObject<{
                color: z.ZodOptional<z.ZodEnum<{
                    blue: "blue";
                    green: "green";
                    yellow: "yellow";
                    orange: "orange";
                    red: "red";
                    pink: "pink";
                    purple: "purple";
                    cyan: "cyan";
                }>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        runtime: z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ReadinessOptionsSchema: z.ZodObject<{
    workflow: z.ZodOptional<z.ZodEnum<{
        "execute-work": "execute-work";
        "execute-wave": "execute-wave";
        "break-down-work": "break-down-work";
        "reproduce-bug": "reproduce-bug";
        "verify-ticket": "verify-ticket";
    }>>;
    evidence: z.ZodOptional<z.ZodObject<{
        context: z.ZodObject<{
            runId: z.ZodString;
            taskId: z.ZodString;
            cwd: z.ZodString;
            repositoryRoot: z.ZodString;
            baseRef: z.ZodString;
            skill: z.ZodString;
            attempt: z.ZodInt;
        }, z.core.$strict>;
        callerCapabilities: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        workers: z.ZodArray<z.ZodObject<{
            registration: z.ZodObject<{
                name: z.ZodString;
                description: z.ZodString;
                capabilities: z.ZodArray<z.ZodEnum<{
                    edit: "edit";
                    read: "read";
                    shell: "shell";
                    web: "web";
                    spawn: "spawn";
                    ask: "ask";
                }>>;
                model: z.ZodEnum<{
                    standard: "standard";
                    escalated: "escalated";
                    expert: "expert";
                }>;
                modelReason: z.ZodOptional<z.ZodString>;
                reasoning: z.ZodOptional<z.ZodEnum<{
                    low: "low";
                    medium: "medium";
                    high: "high";
                }>>;
                sandbox: z.ZodOptional<z.ZodObject<{
                    fs: z.ZodEnum<{
                        "read-only": "read-only";
                        "workspace-write": "workspace-write";
                    }>;
                    network: z.ZodEnum<{
                        enabled: "enabled";
                        none: "none";
                    }>;
                }, z.core.$strict>>;
                dispatch: z.ZodOptional<z.ZodObject<{
                    maxConcurrent: z.ZodInt;
                    maxDepth: z.ZodInt;
                }, z.core.$strict>>;
                "x-claude": z.ZodOptional<z.ZodObject<{
                    color: z.ZodOptional<z.ZodEnum<{
                        blue: "blue";
                        green: "green";
                        yellow: "yellow";
                        orange: "orange";
                        red: "red";
                        pink: "pink";
                        purple: "purple";
                        cyan: "cyan";
                    }>>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            runtime: z.ZodObject<{
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
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowEvidence = z.infer<typeof WorkflowEvidenceSchema>;
export type ReadinessOptions = z.infer<typeof ReadinessOptionsSchema>;
export type ReadinessCheck = {
    name: string;
    ok: boolean;
    detail: string;
    required?: boolean;
    code?: string | undefined;
    remedy?: string | undefined;
};
export type ReadinessReport = {
    tracker: string | null;
    repo: string | null | undefined;
    checks: ReadinessCheck[];
    ok: boolean;
    workflow?: Workflow;
    scope: "environment" | "workflow";
};
