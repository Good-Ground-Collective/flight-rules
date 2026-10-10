import { z } from "zod";
/**
 * The production Ariadne API; the `ariadne.url` config key overrides it.
 * Shapes in this file follow Ariadne's Agents API, contract version 1
 * (think-lp/ariadne docs/agents-api.md).
 */
export declare const defaultAriadneUrl = "https://ariadne-api-xohlbba2ea-uc.a.run.app";
/**
 * An Ariadne API base URL. It receives the person's bearer token, so it must
 * be https; http is allowed only for localhost and 127.0.0.1.
 */
export declare const AriadneUrlSchema: z.ZodURL;
export declare const agentStates: readonly ["nominal", "caution", "abort", "hold"];
export declare const agentItemKinds: readonly ["question", "blocker", "testable", "wave-gate"];
export declare const agentActivityLevels: readonly ["info", "success", "caution", "abort"];
export type AgentState = (typeof agentStates)[number];
export type AgentItemKind = (typeof agentItemKinds)[number];
export type AgentActivityLevel = (typeof agentActivityLevels)[number];
export declare const agentLimits: {
    readonly step: 60;
    readonly heartbeatDetail: 500;
    readonly title: 200;
    readonly itemDetail: 2000;
    readonly option: 60;
    readonly options: 6;
    readonly text: 500;
    readonly branch: 255;
};
/** Optional fields may be omitted, null or "". */
export declare const optionalSchema: <T extends z.ZodType>(schema: T) => z.ZodPreprocess<z.ZodOptional<T>, unknown>;
export declare const AgentSessionIdSchema: z.ZodString;
/** A record's own id (`--id`), the same alphabet as a session id. */
export declare const AgentRecordIdSchema: z.ZodString;
export declare const TicketKeySchema: z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>;
/**
 * Request schemas are strict, so a payload can only ever carry these fields:
 * keys, titles and short status lines, never source code, diffs or ticket bodies.
 */
export declare const HeartbeatInputSchema: z.ZodObject<{
    session: z.ZodString;
    step: z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>;
    state: z.ZodEnum<{
        abort: "abort";
        nominal: "nominal";
        caution: "caution";
        hold: "hold";
    }>;
    ticket: z.ZodPreprocess<z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>, unknown>;
    repo: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
    branch: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
    skill: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
    detail: z.ZodPreprocess<z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>, unknown>;
}, z.core.$strict>;
export declare const ItemInputSchema: z.ZodObject<{
    session: z.ZodString;
    kind: z.ZodEnum<{
        question: "question";
        blocker: "blocker";
        testable: "testable";
        "wave-gate": "wave-gate";
    }>;
    title: z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>;
    ticket: z.ZodPreprocess<z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>, unknown>;
    detail: z.ZodPreprocess<z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>, unknown>;
    options: z.ZodOptional<z.ZodArray<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>>;
    id: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
}, z.core.$strict>;
export declare const ActivityInputSchema: z.ZodObject<{
    session: z.ZodString;
    text: z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>;
    level: z.ZodPreprocess<z.ZodOptional<z.ZodEnum<{
        abort: "abort";
        success: "success";
        caution: "caution";
        info: "info";
    }>>, unknown>;
    ticket: z.ZodPreprocess<z.ZodOptional<z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString>>, unknown>;
    id: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
}, z.core.$strict>;
/** POST /v1/agents/heartbeat. Text fields are tidied to one line and cut to their limits. */
export interface HeartbeatInput {
    session: string;
    /** One line up to 60 characters: implement, verify 2/3, pr, qa. */
    step: string;
    state: AgentState;
    /** A Jira issue key; stored upper case. */
    ticket?: string | undefined;
    /** owner/name or name. */
    repo?: string | undefined;
    branch?: string | undefined;
    skill?: string | undefined;
    /** One line up to 500 characters. */
    detail?: string | undefined;
}
/** POST /v1/agents/items. */
export interface ItemInput {
    session: string;
    kind: AgentItemKind;
    /** One line up to 200 characters. */
    title: string;
    ticket?: string | undefined;
    /** Up to 2,000 characters; line breaks allowed. */
    detail?: string | undefined;
    /** Up to six distinct one-line labels of up to 60 characters. */
    options?: string[] | undefined;
    /** Client id; the first write for a session and id wins, and a repost returns the stored item. */
    id?: string | undefined;
}
/** POST /v1/agents/activity. */
export interface ActivityInput {
    session: string;
    /** One line up to 500 characters. */
    text: string;
    level?: AgentActivityLevel | undefined;
    ticket?: string | undefined;
    id?: string | undefined;
}
/** Response records are loose: a later contract may add fields without breaking this client. */
export declare const AgentSessionSchema: z.ZodObject<{
    id: z.ZodString;
    ownerId: z.ZodString;
    ticket: z.ZodNullable<z.ZodString>;
    step: z.ZodString;
    state: z.ZodString;
    lastHeartbeat: z.ZodString;
    running: z.ZodBoolean;
}, z.core.$loose>;
export declare const AgentItemSchema: z.ZodObject<{
    id: z.ZodString;
    session: z.ZodString;
    kind: z.ZodString;
    ticket: z.ZodNullable<z.ZodString>;
    title: z.ZodString;
    detail: z.ZodNullable<z.ZodString>;
    options: z.ZodArray<z.ZodString>;
    status: z.ZodString;
    chosenOption: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    resolvedAt: z.ZodNullable<z.ZodString>;
    resolvedBy: z.ZodNullable<z.ZodString>;
}, z.core.$loose>;
export declare const AgentActivitySchema: z.ZodObject<{
    id: z.ZodString;
    at: z.ZodString;
    session: z.ZodString;
    ticket: z.ZodNullable<z.ZodString>;
    level: z.ZodString;
    text: z.ZodString;
}, z.core.$loose>;
export declare const HeartbeatResponseSchema: z.ZodObject<{
    session: z.ZodObject<{
        id: z.ZodString;
        ownerId: z.ZodString;
        ticket: z.ZodNullable<z.ZodString>;
        step: z.ZodString;
        state: z.ZodString;
        lastHeartbeat: z.ZodString;
        running: z.ZodBoolean;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const ItemResponseSchema: z.ZodObject<{
    item: z.ZodObject<{
        id: z.ZodString;
        session: z.ZodString;
        kind: z.ZodString;
        ticket: z.ZodNullable<z.ZodString>;
        title: z.ZodString;
        detail: z.ZodNullable<z.ZodString>;
        options: z.ZodArray<z.ZodString>;
        status: z.ZodString;
        chosenOption: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
        resolvedAt: z.ZodNullable<z.ZodString>;
        resolvedBy: z.ZodNullable<z.ZodString>;
    }, z.core.$loose>;
    created: z.ZodBoolean;
}, z.core.$loose>;
export declare const ActivityResponseSchema: z.ZodObject<{
    activity: z.ZodObject<{
        id: z.ZodString;
        at: z.ZodString;
        session: z.ZodString;
        ticket: z.ZodNullable<z.ZodString>;
        level: z.ZodString;
        text: z.ZodString;
    }, z.core.$loose>;
    created: z.ZodBoolean;
}, z.core.$loose>;
export declare const ItemListResponseSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        session: z.ZodString;
        kind: z.ZodString;
        ticket: z.ZodNullable<z.ZodString>;
        title: z.ZodString;
        detail: z.ZodNullable<z.ZodString>;
        options: z.ZodArray<z.ZodString>;
        status: z.ZodString;
        chosenOption: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
        resolvedAt: z.ZodNullable<z.ZodString>;
        resolvedBy: z.ZodNullable<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
/** Every error but 401 is `{error, message}`; 401 is `{error: "unauthorized"}`. */
export declare const AgentErrorBodySchema: z.ZodObject<{
    error: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentItem = z.infer<typeof AgentItemSchema>;
export type AgentActivity = z.infer<typeof AgentActivitySchema>;
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
export type ItemResponse = z.infer<typeof ItemResponseSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
