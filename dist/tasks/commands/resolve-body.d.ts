/**
 * Resolves an entity body from either an inline --body string or a --body-file
 * path. A file path is the deterministic way to pass large layered-body markdown
 * (with fenced YAML and nested code) without shell-escaping it. --body-file wins
 * when both are supplied.
 */
export declare function resolveBody(opts: {
    body?: string | undefined;
    bodyFile?: string | undefined;
}): string;
