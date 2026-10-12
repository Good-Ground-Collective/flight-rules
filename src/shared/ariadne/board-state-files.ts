import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";

/** Ids become file names, so only the API's own session alphabet is accepted. */
export const stateIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

export interface BoardStateFilesProps {
  env?: Record<string, string | undefined>;
  home?: string;
  now?: () => number;
}

/**
 * Small JSON files under `$XDG_STATE_HOME/flight-rules/board` (default
 * `~/.local/state/flight-rules/board`), outside every repository, written
 * with mode 0600. Reads never throw: a missing or unreadable file is absent.
 */
export class BoardStateFiles {
  readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;

  constructor(props: BoardStateFilesProps = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
    this.now = props.now ?? Date.now;
  }

  root(): string {
    const stateHome = this.env["XDG_STATE_HOME"];
    const base = stateHome !== undefined && stateHome !== "" ? stateHome : join(this.home, ".local", "state");
    return join(base, "flight-rules", "board");
  }

  read<T>(folder: string | undefined, id: string, schema: z.ZodType<T>): T | undefined {
    const path = this.pathFor(folder, id);
    if (path === undefined || !existsSync(path)) return undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  write(folder: string | undefined, id: string, value: unknown): void {
    const path = this.pathFor(folder, id);
    if (path === undefined) return;
    mkdirSync(this.folder(folder), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  }

  /** Writes a file only if none exists, atomically; returns whether it wrote. */
  create(folder: string | undefined, id: string, value: unknown): boolean {
    const path = this.pathFor(folder, id);
    if (path === undefined) return false;
    mkdirSync(this.folder(folder), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }

  remove(folder: string | undefined, id: string): void {
    const path = this.pathFor(folder, id);
    if (path !== undefined) rmSync(path, { force: true });
  }

  /** Deletes a folder's files last written more than `maxAgeMs` ago. */
  prune(folder: string, maxAgeMs: number): void {
    const dir = this.folder(folder);
    if (!existsSync(dir)) return;
    const cutoff = this.now() - maxAgeMs;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
      } catch {
        continue;
      }
    }
  }

  private folder(folder: string | undefined): string {
    return folder === undefined ? this.root() : join(this.root(), folder);
  }

  private pathFor(folder: string | undefined, id: string): string | undefined {
    return stateIdPattern.test(id) ? join(this.folder(folder), `${id}.json`) : undefined;
  }
}
