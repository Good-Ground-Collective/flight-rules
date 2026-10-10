import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the token in use came from, never the token itself. */
export type AriadneTokenSource = "ARIADNE_AGENT_TOKEN" | "ARIADNE_TOKEN" | "file";

export interface ResolvedAriadneToken {
  token: string;
  source: AriadneTokenSource;
}

const agentTokenPattern = /^ariadne_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;

/** Checked in this order, before the saved file. */
export const ariadneTokenEnvNames = ["ARIADNE_AGENT_TOKEN", "ARIADNE_TOKEN"] as const;

export interface AriadneTokenStoreProps {
  env?: Record<string, string | undefined>;
  home?: string;
}

/**
 * Finds the bearer token for Ariadne's Agents API: `$ARIADNE_AGENT_TOKEN`,
 * then `$ARIADNE_TOKEN` (an interactive Ariadne access token, which the API
 * also accepts), then the agent token `flight-rules board login` saved in the
 * user's flight-rules config directory with mode 0600. It never falls back to
 * the `ariadne` CLI's Keychain session or any interactive sign-in, so each
 * machine needs its own agent token. Nothing here prints or logs a token.
 */
export class AriadneTokenStore {
  private readonly env: Record<string, string | undefined>;
  private readonly home: string;

  constructor(props: AriadneTokenStoreProps = {}) {
    this.env = props.env ?? process.env;
    this.home = props.home ?? homedir();
  }

  isAgentToken(value: string): boolean {
    return agentTokenPattern.test(value);
  }

  /** `$XDG_CONFIG_HOME/flight-rules/ariadne-token`, else `~/.config/flight-rules/ariadne-token`. */
  path(): string {
    const configHome = this.env["XDG_CONFIG_HOME"];
    const base = configHome !== undefined && configHome !== "" ? configHome : join(this.home, ".config");
    return join(base, "flight-rules", "ariadne-token");
  }

  resolve(): ResolvedAriadneToken | undefined {
    for (const name of ariadneTokenEnvNames) {
      const value = this.env[name]?.trim();
      if (value !== undefined && value !== "") return { token: value, source: name };
    }
    const path = this.path();
    if (!existsSync(path)) return undefined;
    const value = readFileSync(path, "utf-8").trim();
    return value === "" ? undefined : { token: value, source: "file" };
  }

  /** The environment variable that would win over a saved file, if one is set. */
  shadowingEnv(): AriadneTokenSource | undefined {
    return ariadneTokenEnvNames.find((name) => (this.env[name]?.trim() ?? "") !== "");
  }

  /** Saves an agent token with mode 0600 and returns the path. Rejects anything that is not one. */
  save(token: string): string {
    const value = token.trim();
    if (!this.isAgentToken(value)) {
      throw new Error(
        "That is not an Ariadne agent token (expected ariadne_agent_<16 hex>_<43 characters>). Create one in Ariadne › Settings › Connections.",
      );
    }
    const path = this.path();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${value}\n`, { mode: 0o600 });
    // writeFileSync keeps an existing file's mode, so tighten it explicitly.
    chmodSync(path, 0o600);
    return path;
  }

  /** Deletes the saved token; returns whether one existed. */
  remove(): boolean {
    const path = this.path();
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}
