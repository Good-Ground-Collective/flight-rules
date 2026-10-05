export declare class JiraApiError extends Error {
    readonly status: number;
    readonly messages: string[];
    readonly fieldErrors: Record<string, string>;
    constructor(status: number, messages: string[], fieldErrors: Record<string, string>);
}
