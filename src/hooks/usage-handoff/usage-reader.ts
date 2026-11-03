import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { UsageSnapshot, UsageWindowSchema, type UsageHarness, type UsageWindow } from "./usage-snapshot.js";

export interface UsageReader {
  /** The plan's current usage, or `undefined` when it can't be read. Never throws. */
  read(): Promise<UsageSnapshot | undefined>;
}

const requestTimeoutMs = 4000;
const codexSessionWindowCutoffSeconds = 24 * 60 * 60;
const rolloutTailBytes = 512 * 1024;
const rolloutFilesTried = 5;

const ClaudeWindowSchema = z
  .object({
    utilization: z.number(),
    resets_at: z
      .string()
      .transform((value) => Date.parse(value))
      .pipe(z.number().finite()),
  })
  .transform((window) => ({ percent: window.utilization, resetsAt: window.resets_at }));

/** Claude Code's usage response; either window is null when the plan doesn't report it. */
const ClaudeUsageSchema = z
  .looseObject({ five_hour: ClaudeWindowSchema.nullish(), seven_day: ClaudeWindowSchema.nullish() })
  .transform((usage): UsageWindow[] => [
    ...(usage.five_hour ? [{ kind: "session" as const, ...usage.five_hour }] : []),
    ...(usage.seven_day ? [{ kind: "weekly" as const, ...usage.seven_day }] : []),
  ]);

const ClaudeCredentialsSchema = z.looseObject({ claudeAiOauth: z.looseObject({ accessToken: z.string().min(1) }) });

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
export class ClaudeCodeUsageReader implements UsageReader {
  private readonly home: string;
  private readonly platform: NodeJS.Platform;

  constructor(props: ClaudeCodeUsageReaderProps = {}) {
    this.home = props.home ?? homedir();
    this.platform = props.platform ?? process.platform;
  }

  async read(): Promise<UsageSnapshot | undefined> {
    try {
      const token = ClaudeCredentialsSchema.parse(JSON.parse(this.credentialsJson())).claudeAiOauth.accessToken;
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) return undefined;
      return new UsageSnapshot(ClaudeUsageSchema.parse(await response.json()));
    } catch {
      return undefined;
    }
  }

  private credentialsJson(): string {
    if (this.platform === "darwin") {
      return execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        encoding: "utf-8",
        timeout: requestTimeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
      });
    }
    return readFileSync(join(this.home, ".claude", ".credentials.json"), "utf-8");
  }
}

const CodexAuthSchema = z.looseObject({
  tokens: z.looseObject({ access_token: z.string().min(1), account_id: z.string().min(1) }),
});

const CodexWindowSchema = z
  .object({
    used_percent: z.number(),
    limit_window_seconds: z.number().positive(),
    reset_at: z.number(),
  })
  .transform((window) => ({
    kind: window.limit_window_seconds < codexSessionWindowCutoffSeconds ? ("session" as const) : ("weekly" as const),
    percent: window.used_percent,
    resetsAt: window.reset_at * 1000,
  }));

/** Plans may report only a weekly window as `primary`, so windows are classified by length, not by slot. */
const CodexUsageSchema = z
  .looseObject({
    rate_limit: z.looseObject({
      primary_window: CodexWindowSchema.nullish(),
      secondary_window: CodexWindowSchema.nullish(),
    }),
  })
  .transform((usage): UsageWindow[] =>
    [usage.rate_limit.primary_window, usage.rate_limit.secondary_window].filter((window) => window != null),
  );

const RolloutWindowSchema = z
  .object({
    used_percent: z.number(),
    window_minutes: z.number().positive(),
    resets_at: z.number(),
  })
  .transform((window) => ({
    kind: window.window_minutes * 60 < codexSessionWindowCutoffSeconds ? ("session" as const) : ("weekly" as const),
    percent: window.used_percent,
    resetsAt: window.resets_at * 1000,
  }));

const RolloutLineSchema = z
  .looseObject({
    payload: z.looseObject({
      rate_limits: z.looseObject({ primary: RolloutWindowSchema.nullish(), secondary: RolloutWindowSchema.nullish() }),
    }),
  })
  .transform((line): UsageWindow[] =>
    [line.payload.rate_limits.primary, line.payload.rate_limits.secondary].filter((window) => window != null),
  );

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
export class CodexUsageReader implements UsageReader {
  private readonly codexHome: string;

  constructor(props: CodexUsageReaderProps = {}) {
    const env = props.env ?? process.env;
    const configured = env["CODEX_HOME"];
    this.codexHome = configured !== undefined && configured !== "" ? configured : join(props.home ?? homedir(), ".codex");
  }

  async read(): Promise<UsageSnapshot | undefined> {
    const live = await this.readLive();
    if (live !== undefined) return live;
    return this.readLatestRollout();
  }

  private async readLive(): Promise<UsageSnapshot | undefined> {
    try {
      const { tokens } = CodexAuthSchema.parse(JSON.parse(readFileSync(join(this.codexHome, "auth.json"), "utf-8")));
      const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "ChatGPT-Account-Id": tokens.account_id,
          "User-Agent": "codex-cli",
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) return undefined;
      return new UsageSnapshot(CodexUsageSchema.parse(await response.json()));
    } catch {
      return undefined;
    }
  }

  private readLatestRollout(): UsageSnapshot | undefined {
    try {
      const newestFirst = this.rolloutFiles().sort((a, b) => basename(b).localeCompare(basename(a)));
      for (const file of newestFirst.slice(0, rolloutFilesTried)) {
        const line = this.lastRateLimitLine(file);
        if (line !== undefined) return new UsageSnapshot(RolloutLineSchema.parse(JSON.parse(line)));
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private rolloutFiles(): string[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/^rollout-.*\.jsonl$/.test(entry.name)) files.push(path);
      }
    };
    const sessions = join(this.codexHome, "sessions");
    if (existsSync(sessions)) visit(sessions);
    return files;
  }

  private lastRateLimitLine(file: string): string | undefined {
    const size = statSync(file).size;
    const length = Math.min(size, rolloutTailBytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return buffer
      .toString("utf-8")
      .split("\n")
      .reverse()
      .find((line) => line.includes('"rate_limits":{'));
  }
}

const CachedUsageSchema = z.object({ fetchedAt: z.number(), windows: z.array(UsageWindowSchema) });

export interface CachedUsageReaderProps {
  harness: UsageHarness;
  reader: UsageReader;
  folder: string;
  ttlMs?: number;
}

/** Keeps a harness's last successful usage read for about a minute, so every Stop doesn't hit the endpoint. */
export class CachedUsageReader implements UsageReader {
  private readonly path: string;
  private readonly reader: UsageReader;
  private readonly ttlMs: number;

  constructor(props: CachedUsageReaderProps) {
    this.path = join(props.folder, `usage-${props.harness}.json`);
    this.reader = props.reader;
    this.ttlMs = props.ttlMs ?? 60_000;
  }

  async read(): Promise<UsageSnapshot | undefined> {
    const cached = this.readCache();
    if (cached !== undefined) return cached;

    const fresh = await this.reader.read();
    if (fresh !== undefined) this.writeCache(fresh);
    return fresh;
  }

  private readCache(): UsageSnapshot | undefined {
    try {
      const parsed = CachedUsageSchema.parse(JSON.parse(readFileSync(this.path, "utf-8")));
      if (Date.now() - parsed.fetchedAt > this.ttlMs) return undefined;
      return new UsageSnapshot(parsed.windows);
    } catch {
      return undefined;
    }
  }

  private writeCache(snapshot: UsageSnapshot): void {
    try {
      mkdirSync(join(this.path, ".."), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ fetchedAt: Date.now(), windows: snapshot.windows }));
      renameSync(temporary, this.path);
    } catch {
      return;
    }
  }
}
