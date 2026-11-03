import { UsageSnapshot, type UsageHarness } from "./usage-snapshot.js";
export interface UsageReader {
    /** The plan's current usage, or `undefined` when it can't be read. Never throws. */
    read(): Promise<UsageSnapshot | undefined>;
}
export interface ClaudeCodeUsageReaderProps {
    env?: Record<string, string | undefined>;
    home?: string;
    platform?: NodeJS.Platform;
}
/**
 * Reads Claude Code's session and weekly usage from the undocumented
 * `api/oauth/usage` endpoint, authenticating with the OAuth token Claude Code
 * itself stores (macOS Keychain, else `~/.claude/.credentials.json`). If the
 * endpoint or the credential location changes, this class is the only fix.
 */
export declare class ClaudeCodeUsageReader implements UsageReader {
    private readonly home;
    private readonly platform;
    constructor(props?: ClaudeCodeUsageReaderProps);
    read(): Promise<UsageSnapshot | undefined>;
    private credentialsJson;
}
export interface CodexUsageReaderProps {
    env?: Record<string, string | undefined>;
    home?: string;
}
/**
 * Reads Codex's session and weekly usage from the undocumented
 * `wham/usage` endpoint with the ChatGPT token in `auth.json`. When that
 * fails it falls back to the rate limits Codex logged in its newest session
 * rollout, which are only as fresh as Codex's last turn.
 */
export declare class CodexUsageReader implements UsageReader {
    private readonly codexHome;
    constructor(props?: CodexUsageReaderProps);
    read(): Promise<UsageSnapshot | undefined>;
    private readLive;
    private readLatestRollout;
    private rolloutFiles;
    private lastRateLimitLine;
}
export interface CachedUsageReaderProps {
    harness: UsageHarness;
    reader: UsageReader;
    folder: string;
    ttlMs?: number;
}
/** Keeps a harness's last successful usage read for about a minute, so every Stop doesn't hit the endpoint. */
export declare class CachedUsageReader implements UsageReader {
    private readonly path;
    private readonly reader;
    private readonly ttlMs;
    constructor(props: CachedUsageReaderProps);
    read(): Promise<UsageSnapshot | undefined>;
    private readCache;
    private writeCache;
}
