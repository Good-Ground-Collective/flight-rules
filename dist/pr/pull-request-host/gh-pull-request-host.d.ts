import { z } from 'zod';
import { type PullRequestBuilder, type PullRequestTemplate } from '../../git/pr-template/pr-template.js';
import type { CreatedPullRequest, PullRequestAttachOptions, PullRequestComment, PullRequestHost } from './pull-request-host.js';
type ExecFileFn = (file: string, args: readonly string[]) => Promise<{
    stdout: string;
    stderr: string;
}>;
declare const GhPullRequestHostPropsSchema: z.ZodObject<{
    repo: z.ZodString;
}, z.core.$strip>;
export type GhPullRequestHostProps = z.input<typeof GhPullRequestHostPropsSchema> & {
    builder?: PullRequestBuilder;
    execFileFn?: ExecFileFn;
};
/** gh printed no recognizable pull request URL on stdout, so the create/comment result cannot be reported back to the caller. */
export declare class GhOutputParseError extends Error {
    name: string;
    constructor(stdout: string);
}
/**
 * Opens pull requests and posts comments by shelling out to the `gh` CLI, so
 * screenshots and video reach a PR through `--attach` — an upload path
 * Octokit cannot reach. Authentication comes from gh's own keyring (or
 * GH_TOKEN/GITHUB_TOKEN), not a token this class manages.
 */
export declare class GhPullRequestHost implements PullRequestHost {
    private readonly repo;
    private readonly builder;
    private readonly execFile;
    constructor(props: GhPullRequestHostProps);
    createPullRequest(input: PullRequestTemplate, options?: PullRequestAttachOptions): Promise<CreatedPullRequest>;
    commentOnPullRequest(number: number, body: string, options?: PullRequestAttachOptions): Promise<PullRequestComment>;
    private runCreate;
    private parseCreated;
    private withBodyFile;
    private readStringProperty;
}
export {};
