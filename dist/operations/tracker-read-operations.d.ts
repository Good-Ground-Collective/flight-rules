import { z } from "zod";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { type TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import type { OperationDescriptor } from "./operation-registry.js";
import { type OperationRegistry } from "./operation-registry.js";
declare const propsSchema: z.ZodObject<{
    getTracker: z.ZodCustom<() => TaskTracker, () => TaskTracker>;
    getPrHost: z.ZodOptional<z.ZodCustom<() => PullRequestHost, () => PullRequestHost>>;
    getConfig: z.ZodOptional<z.ZodCustom<() => Pick<Config, "inReviewStatus">, () => Pick<Config, "inReviewStatus">>>;
}, z.core.$strip>;
export declare const TrackerDependencyPlanSchema: z.ZodObject<{
    waves: z.ZodArray<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        status: z.ZodString;
        blockedBy: z.ZodArray<z.ZodString>;
        epicId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    cycles: z.ZodArray<z.ZodString>;
    crossEpicEdges: z.ZodArray<z.ZodObject<{
        ticket: z.ZodString;
        ticketEpic: z.ZodString;
        blockedBy: z.ZodString;
        blockerEpic: z.ZodNullable<z.ZodString>;
        justification: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    warnings: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const TrackerReviewPlanSchema: z.ZodObject<{
    epic: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, z.core.$strip>>;
    initiative: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, z.core.$strip>>;
    defaultBranch: z.ZodString;
    route: z.ZodEnum<{
        simple: "simple";
        complex: "complex";
        incomplete: "incomplete";
    }>;
    reasons: z.ZodArray<z.ZodString>;
    missing: z.ZodArray<z.ZodString>;
    blocked: z.ZodArray<z.ZodObject<{
        ticketId: z.ZodString;
        title: z.ZodString;
        wave: z.ZodNumber;
        blockedBy: z.ZodArray<z.ZodString>;
        pr: z.ZodNullable<z.ZodObject<{
            number: z.ZodNumber;
            url: z.ZodString;
            headRefName: z.ZodString;
            baseRefName: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    unblocksOnMerge: z.ZodArray<z.ZodString>;
    crossEpicEdges: z.ZodArray<z.ZodObject<{
        ticket: z.ZodString;
        ticketEpic: z.ZodString;
        blockedBy: z.ZodString;
        blockerEpic: z.ZodNullable<z.ZodString>;
        justification: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    warnings: z.ZodArray<z.ZodString>;
    cycles: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export interface TrackerReadOperations {
    operations(): OperationDescriptor[];
}
/** Shares tracker reads and graph plans across Commander and programmatic hosts. */
export declare class DefaultTrackerReadOperations implements TrackerReadOperations {
    private readonly props;
    constructor(props: z.input<typeof propsSchema>);
    operations(): OperationDescriptor[];
    registry(): OperationRegistry;
    private descriptor;
    private getTicket;
    private planEpic;
    private planInitiative;
    private reviewEpic;
    private reviewInitiative;
    private reviewPlan;
    private plannerTickets;
}
export declare class PullRequestHostUnavailableError extends Error {
    name: string;
}
export {};
