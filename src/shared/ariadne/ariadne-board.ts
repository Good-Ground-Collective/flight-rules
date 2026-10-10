import type { ConfigScope } from "../config-store.js";
import { AriadneClient, AriadneError } from "./ariadne-client.js";
import type { AriadneTransport } from "./ariadne-transport.js";
import { AriadneUrlSchema, defaultAriadneUrl } from "./ariadne.schema.js";
import type {
  ActivityInput,
  ActivityResponse,
  HeartbeatInput,
  HeartbeatResponse,
  ItemInput,
  ItemListResponse,
  ItemResponse,
} from "./ariadne.schema.js";
import type { AriadneTokenStore } from "./ariadne-token-store.js";

/** A board call whose `session` falls back to the Claude Code session id. */
export type BoardInput<T extends { session: string }> = Omit<T, "session"> & { session?: string | undefined };

export interface BoardCallOptions {
  /**
   * Off (the default), a missing token is a silent skip. On, the request is
   * sent without one, so the API's own answer (401) surfaces as a failure.
   * Callers map a failure to exit 1 only under strict.
   */
  strict?: boolean;
}

/**
 * `notices` name config the board ignored. They are diagnostics: callers
 * print them only when asked to be loud (`--strict`, `board items`).
 */
export type BoardOutcome<T> = (
  | { status: "skipped"; reason: "disabled" | "no-token" | "invalid-url" }
  | { status: "posted"; value: T }
  | { status: "failed"; message: string }
) & { notices?: string[] };

export interface AriadneBoardSettings {
  /** Undefined when the configured URL failed validation: the board is then not configured. */
  url: string | undefined;
  enabled: boolean;
  notices: string[];
}

/** One config layer, as `ConfigStore.layers()` returns it. */
export interface BoardConfigLayer {
  scope: ConfigScope;
  values: Record<string, unknown>;
}

export interface AriadneBoardProps {
  /** The flight-rules config layers, lowest precedence first; `ariadne.*` keys are read from the person's own. */
  readLayers: () => readonly BoardConfigLayer[];
  tokens: AriadneTokenStore;
  env?: Record<string, string | undefined>;
  transport?: AriadneTransport;
  timeoutMs?: number;
}

/** Claude Code exports the session id to every Bash tool call it runs. */
export const claudeSessionEnv = "CLAUDE_CODE_SESSION_ID";

/** The step a session gets when an item or activity line is its first report. */
export const bootstrapStep = "started";

/**
 * The layers a person controls and does not commit. A repo's committed
 * project settings or config file could otherwise point the board, and the
 * person's token, at any host.
 */
const personalScopes: ReadonlySet<ConfigScope> = new Set(["user", "local"]);

const scopeLabels: Record<ConfigScope, string> = {
  user: "user settings",
  project: "project settings",
  local: "local settings",
  file: "the flight-rules config file",
};

const urlKey = "ariadne.url";
const enabledKey = "ariadne.enabled";

/**
 * Reports a flight-rules run to Ariadne's Agents page. Opt-in and quiet: with
 * `ariadne.enabled` false, or no token, every call is skipped; every other
 * problem comes back as a one-line failure instead of a throw, so a hook or
 * skill can never fail because of Ariadne.
 */
export class AriadneBoard {
  private readonly readLayers: () => readonly BoardConfigLayer[];
  private readonly tokens: AriadneTokenStore;
  private readonly env: Record<string, string | undefined>;
  private readonly transport: AriadneTransport | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(props: AriadneBoardProps) {
    this.readLayers = props.readLayers;
    this.tokens = props.tokens;
    this.env = props.env ?? process.env;
    this.transport = props.transport;
    this.timeoutMs = props.timeoutMs;
  }

  /**
   * `ariadne.url` (default: production) and `ariadne.enabled` (default:
   * true), read only from the user and local layers, local winning. Project
   * and file layers are ignored with a notice. A URL that is not https (or
   * http on localhost) leaves `url` undefined, so nothing is ever sent to it.
   */
  settings(): AriadneBoardSettings {
    const notices: string[] = [];
    let rawUrl: { value: unknown; scope: ConfigScope } | undefined;
    let rawEnabled: { value: unknown; scope: ConfigScope } | undefined;
    for (const layer of this.readLayers()) {
      for (const key of [urlKey, enabledKey]) {
        if (!(key in layer.values)) continue;
        const value = layer.values[key];
        if (!personalScopes.has(layer.scope)) {
          notices.push(`ignored ${key} from ${scopeLabels[layer.scope]}; set it in user scope`);
          continue;
        }
        if (value === undefined || value === null || value === "") continue;
        if (key === urlKey) rawUrl = { value, scope: layer.scope };
        else rawEnabled = { value, scope: layer.scope };
      }
    }

    let url: string | undefined = defaultAriadneUrl;
    if (rawUrl !== undefined) {
      const parsed = AriadneUrlSchema.safeParse(rawUrl.value);
      url = parsed.success ? parsed.data : undefined;
      if (!parsed.success) {
        notices.push(
          `ignored ${urlKey} from ${scopeLabels[rawUrl.scope]}: ${parsed.error.issues.map((i) => i.message).join("; ")}; nothing is sent until it is fixed`,
        );
      }
    }

    let enabled = true;
    if (rawEnabled !== undefined) {
      const value = rawEnabled.value;
      if (value === true || value === "true") enabled = true;
      else if (value === false || value === "false") enabled = false;
      else {
        enabled = false;
        notices.push(`ignored ${enabledKey} from ${scopeLabels[rawEnabled.scope]}: expected true or false; reporting is off until it is fixed`);
      }
    }
    return { url, enabled, notices };
  }

  /** The Claude Code session id, when this process runs inside a session. */
  defaultSession(): string | undefined {
    const value = this.env[claudeSessionEnv]?.trim();
    return value === undefined || value === "" ? undefined : value;
  }

  async heartbeat(input: BoardInput<HeartbeatInput>, options: BoardCallOptions = {}): Promise<BoardOutcome<HeartbeatResponse>> {
    return this.call(options, input.session, (client, session) => client.heartbeat({ ...input, session }));
  }

  /**
   * Posts an item. A session that has never sent a heartbeat (or has aged
   * out) gets one first, with step `started` and state `nominal`, and the item
   * is posted again. A live session's step is never overwritten this way.
   */
  async item(input: BoardInput<ItemInput>, options: BoardCallOptions = {}): Promise<BoardOutcome<ItemResponse>> {
    return this.call(options, input.session, (client, session) =>
      this.withSession(client, session, input.ticket, () => client.postItem({ ...input, session })),
    );
  }

  /** Posts one activity line, creating the session first as `item` does. */
  async activity(input: BoardInput<ActivityInput>, options: BoardCallOptions = {}): Promise<BoardOutcome<ActivityResponse>> {
    return this.call(options, input.session, (client, session) =>
      this.withSession(client, session, input.ticket, () => client.postActivity({ ...input, session })),
    );
  }

  /** Every item of one of the caller's sessions, open and resolved, with any chosen option. */
  async items(session: string | undefined, options: BoardCallOptions = {}): Promise<BoardOutcome<ItemListResponse>> {
    return this.call(options, session, (client, id) => client.listItems(id));
  }

  private async withSession<T>(
    client: AriadneClient,
    session: string,
    ticket: string | undefined,
    post: () => Promise<T>,
  ): Promise<T> {
    try {
      return await post();
    } catch (err) {
      if (!(err instanceof AriadneError) || err.code !== "session_not_found") throw err;
    }
    await client.heartbeat({ session, ticket, step: bootstrapStep, state: "nominal" });
    return post();
  }

  private async call<T>(
    options: BoardCallOptions,
    requestedSession: string | undefined,
    run: (client: AriadneClient, session: string) => Promise<T>,
  ): Promise<BoardOutcome<T>> {
    let settings: AriadneBoardSettings;
    try {
      settings = this.settings();
    } catch (err) {
      return { status: "failed", message: err instanceof Error ? err.message : String(err) };
    }
    const noted = <O extends BoardOutcome<T>>(outcome: O): O =>
      settings.notices.length > 0 ? { ...outcome, notices: settings.notices } : outcome;
    const url = settings.url;
    if (!settings.enabled) return noted({ status: "skipped", reason: "disabled" });
    if (url === undefined) return noted({ status: "skipped", reason: "invalid-url" });

    let token: string | undefined;
    try {
      token = this.tokens.resolve()?.token;
    } catch (err) {
      return noted({ status: "failed", message: err instanceof Error ? err.message : String(err) });
    }
    if (token === undefined && options.strict !== true) return noted({ status: "skipped", reason: "no-token" });

    const session = requestedSession ?? this.defaultSession();
    if (session === undefined) {
      return noted({
        status: "failed",
        message: `no session id: pass --session, or run inside Claude Code so ${claudeSessionEnv} is set`,
      });
    }

    const client = new AriadneClient({
      baseUrl: url,
      token,
      ...(this.transport !== undefined ? { transport: this.transport } : {}),
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });
    try {
      return noted({ status: "posted", value: await run(client, session) });
    } catch (err) {
      return noted({ status: "failed", message: this.redact(this.describe(err, url, token !== undefined), token) });
    }
  }

  private describe(err: unknown, url: string, hasToken: boolean): string {
    if (!(err instanceof AriadneError)) return err instanceof Error ? err.message : String(err);
    if (err.status === 401 && err.code === "agent_token_expired") {
      return "Ariadne agent token expired (401 agent_token_expired) — create a new one in Ariadne › Settings › Connections and run `flight-rules board login`";
    }
    if (err.status === 401) {
      return hasToken
        ? "Ariadne agent token not recognised (401 unauthorized); it may be revoked or mistyped. Create a new one in Ariadne › Settings › Connections and set ARIADNE_AGENT_TOKEN or run `flight-rules board login`"
        : "no Ariadne token (401 unauthorized). Set ARIADNE_AGENT_TOKEN, or run `flight-rules board login` with an agent token from Ariadne › Settings › Connections";
    }
    if (err.code === "agents_opt_in_required") {
      return "Agents reporting is off for you (403 agents_opt_in_required). Turn on Agents in Ariadne › Settings › Connections";
    }
    if (err.failure === "network") return `could not reach Ariadne at ${url}: ${err.message}`;
    return `Ariadne ${err.failure === "http" ? "returned" : "request failed:"} ${err.message}`;
  }

  /** Belt and braces: no message may ever carry the token. */
  private redact(message: string, token: string | undefined): string {
    return token === undefined || token === "" ? message : message.split(token).join("[redacted]");
  }
}
