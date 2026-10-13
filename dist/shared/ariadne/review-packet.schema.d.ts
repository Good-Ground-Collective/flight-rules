import { z } from "zod";
/**
 * Shapes in this file follow Ariadne's Review Packets API, contract version 1
 * (think-lp/ariadne docs/review-packets-api.md). Request schemas are strict and
 * reject over-long text: unlike board posts, a packet's annotations are never
 * cut to fit.
 */
export declare const packetLimits: {
    readonly title: 200;
    readonly objective: 600;
    readonly highlight: 200;
    readonly highlights: 5;
    readonly prs: 30;
    readonly focusAreas: 10;
    readonly rationale: 2000;
    readonly anchors: 10;
    readonly path: 400;
    readonly reviewers: 10;
    readonly ticket: 100;
};
export declare const focusAreaKinds: readonly ["design-pattern", "business-logic", "data-schema", "other"];
export declare const anchorSides: readonly ["LEFT", "RIGHT"];
export declare const PacketIdSchema: z.ZodString;
export declare const OperationIdSchema: z.ZodString;
export declare const PacketAnchorSchema: z.ZodObject<{
    path: z.ZodString;
    line: z.ZodNumber;
    startLine: z.ZodPreprocess<z.ZodOptional<z.ZodNumber>, unknown>;
    side: z.ZodEnum<{
        LEFT: "LEFT";
        RIGHT: "RIGHT";
    }>;
}, z.core.$strict>;
export declare const FocusAreaSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        "design-pattern": "design-pattern";
        "business-logic": "business-logic";
        "data-schema": "data-schema";
        other: "other";
    }>;
    title: z.ZodString;
    rationale: z.ZodString;
    anchors: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        line: z.ZodNumber;
        startLine: z.ZodPreprocess<z.ZodOptional<z.ZodNumber>, unknown>;
        side: z.ZodEnum<{
            LEFT: "LEFT";
            RIGHT: "RIGHT";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PacketPrSchema: z.ZodObject<{
    repo: z.ZodString;
    number: z.ZodNumber;
    headSha: z.ZodString;
    title: z.ZodString;
    ticket: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
    signOff: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        headSha: z.ZodString;
    }, z.core.$strict>>>;
    focusAreas: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            "design-pattern": "design-pattern";
            "business-logic": "business-logic";
            "data-schema": "data-schema";
            other: "other";
        }>;
        title: z.ZodString;
        rationale: z.ZodString;
        anchors: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            line: z.ZodNumber;
            startLine: z.ZodPreprocess<z.ZodOptional<z.ZodNumber>, unknown>;
            side: z.ZodEnum<{
                LEFT: "LEFT";
                RIGHT: "RIGHT";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PacketInputSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    overview: z.ZodObject<{
        objective: z.ZodString;
        highlights: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    prs: z.ZodArray<z.ZodObject<{
        repo: z.ZodString;
        number: z.ZodNumber;
        headSha: z.ZodString;
        title: z.ZodString;
        ticket: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
        signOff: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            headSha: z.ZodString;
        }, z.core.$strict>>>;
        focusAreas: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                "design-pattern": "design-pattern";
                "business-logic": "business-logic";
                "data-schema": "data-schema";
                other: "other";
            }>;
            title: z.ZodString;
            rationale: z.ZodString;
            anchors: z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                line: z.ZodNumber;
                startLine: z.ZodPreprocess<z.ZodOptional<z.ZodNumber>, unknown>;
                side: z.ZodEnum<{
                    LEFT: "LEFT";
                    RIGHT: "RIGHT";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    reviewers: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const PacketUpdateSchema: z.ZodObject<{
    expectedRevision: z.ZodNumber;
    operationId: z.ZodString;
    packet: z.ZodObject<{
        reviewers: z.ZodArray<z.ZodString>;
        title: z.ZodString;
        overview: z.ZodObject<{
            objective: z.ZodString;
            highlights: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        prs: z.ZodArray<z.ZodObject<{
            repo: z.ZodString;
            number: z.ZodNumber;
            headSha: z.ZodString;
            title: z.ZodString;
            ticket: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
            signOff: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                at: z.ZodString;
                headSha: z.ZodString;
            }, z.core.$strict>>>;
            focusAreas: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    "design-pattern": "design-pattern";
                    "business-logic": "business-logic";
                    "data-schema": "data-schema";
                    other: "other";
                }>;
                title: z.ZodString;
                rationale: z.ZodString;
                anchors: z.ZodArray<z.ZodObject<{
                    path: z.ZodString;
                    line: z.ZodNumber;
                    startLine: z.ZodPreprocess<z.ZodOptional<z.ZodNumber>, unknown>;
                    side: z.ZodEnum<{
                        LEFT: "LEFT";
                        RIGHT: "RIGHT";
                    }>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const PacketSchema: z.ZodObject<{
    id: z.ZodString;
    authorId: z.ZodString;
    title: z.ZodString;
    overview: z.ZodObject<{
        objective: z.ZodString;
        highlights: z.ZodArray<z.ZodString>;
    }, z.core.$loose>;
    prs: z.ZodArray<z.ZodObject<{
        repo: z.ZodString;
        number: z.ZodNumber;
    }, z.core.$loose>>;
    reviewers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        github: z.ZodObject<{
            id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            login: z.ZodString;
        }, z.core.$loose>;
    }, z.core.$loose>>;
    status: z.ZodEnum<{
        open: "open";
        closed: "closed";
    }>;
    revision: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$loose>;
export declare const ReviewerSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    github: z.ZodObject<{
        id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        login: z.ZodString;
    }, z.core.$loose>;
}, z.core.$loose>;
/** Create, read and replace answer `{packet}`; the client hands back the packet itself. */
export declare const PacketResponseSchema: z.ZodPipe<z.ZodObject<{
    packet: z.ZodObject<{
        id: z.ZodString;
        authorId: z.ZodString;
        title: z.ZodString;
        overview: z.ZodObject<{
            objective: z.ZodString;
            highlights: z.ZodArray<z.ZodString>;
        }, z.core.$loose>;
        prs: z.ZodArray<z.ZodObject<{
            repo: z.ZodString;
            number: z.ZodNumber;
        }, z.core.$loose>>;
        reviewers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            github: z.ZodObject<{
                id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
                login: z.ZodString;
            }, z.core.$loose>;
        }, z.core.$loose>>;
        status: z.ZodEnum<{
            open: "open";
            closed: "closed";
        }>;
        revision: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodTransform<{
    [x: string]: unknown;
    id: string;
    authorId: string;
    title: string;
    overview: {
        [x: string]: unknown;
        objective: string;
        highlights: string[];
    };
    prs: {
        [x: string]: unknown;
        repo: string;
        number: number;
    }[];
    reviewers: {
        [x: string]: unknown;
        id: string;
        github: {
            [x: string]: unknown;
            id: string | number;
            login: string;
        };
    }[];
    status: "open" | "closed";
    revision: number;
    createdAt: string;
    updatedAt: string;
}, {
    [x: string]: unknown;
    packet: {
        [x: string]: unknown;
        id: string;
        authorId: string;
        title: string;
        overview: {
            [x: string]: unknown;
            objective: string;
            highlights: string[];
        };
        prs: {
            [x: string]: unknown;
            repo: string;
            number: number;
        }[];
        reviewers: {
            [x: string]: unknown;
            id: string;
            github: {
                [x: string]: unknown;
                id: string | number;
                login: string;
            };
        }[];
        status: "open" | "closed";
        revision: number;
        createdAt: string;
        updatedAt: string;
    };
}>>;
export declare const ReviewerListResponseSchema: z.ZodObject<{
    reviewers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        github: z.ZodObject<{
            id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
            login: z.ZodString;
        }, z.core.$loose>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export type PacketInput = z.input<typeof PacketInputSchema>;
export type PacketUpdateInput = z.input<typeof PacketUpdateSchema>;
export type Packet = z.infer<typeof PacketSchema>;
export type Reviewer = z.infer<typeof ReviewerSchema>;
export type ReviewerListResponse = z.infer<typeof ReviewerListResponseSchema>;
