import type { ConfigScope } from "../config-store.js";
import { AriadneClient, AriadneError } from "./ariadne-client.js";
import type { AriadneTransport } from "./ariadne-transport.js";
import { AriadneUrlSchema, TicketKeySchema, defaultAriadneUrl } from "./ariadne.schema.js";
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
import { ticketSessionKey } from "./board-session-store.js";
import type { BoardSessionStore } from "./board-session-store.js";

/** A board call whose `session` falls back to `<Claude Code session id>-<TICKET>`. */
export type BoardInput<T extends { session: string }> = Omit<T, "session"> & { session?: string | undefined };

export interface BoardCallOptions {
  /**
   * Off (the default), a missing token is a silent skip. On, the request is
   * sent without one, so the API's own answer (401) surfaces as a failure.
   * Callers map a failure to exit 1 only under strict.
   */
  strict?: boolean;
}

/** Options for an item or activity line, which may have to create its session first. */
export interface BoardReportOptions extends BoardCallOptions {
  /** The skill reporting, so a session this post creates names it instead of showing none. */
  skill?: string | undefined;
}

/** The session an item or activity line may have to create first. */
interface BootstrapTarget {
  session: string;
  ticket: string | undefined;
  skill: string | undefined;
  /** Whether the session is the default `<Claude Code session id>-<TICKET>` rather than an explicit `--session`. */
  defaulted: boolean;
}

/**
 * `notices` name config the board ignored. They are diagnostics: callers
 * print them only when asked to be loud (`--strict`, `board items`).
 */
export type BoardSkipReason = "disabled" | "no-token" | "invalid-url" | "not-jira-ticket" | "nothing-recorded";

export type BoardOutcome<T> = (
  | { status: "skipped"; reason: BoardSkipReason }
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
  /** Where skill heartbeats are remembered for the heartbeat hook; none means nothing is remembered. */
  sessions?: BoardSessionStore;
}

/** Claude Code exports the session id to every Bash tool call it runs. */
export const claudeSessionEnv = "CLAUDE_CODE_SESSION_ID";

/** The step a session gets when an item or activity line is its first report. */
export const bootstrapStep = "started";

/**
 * How recent a recorded skill heartbeat must be to recreate a missing
 * session with it. The heartbeat hook keeps a skill's session alive for the
 * same hour; an older record belongs to a finished run.
 */
const bootstrapRecoveryMs = 60 * 60_000;

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
  private readonly sessions: BoardSessionStore | undefined;

  constructor(props: AriadneBoardProps) {
    this.readLayers = props.readLayers;
    this.tokens = props.tokens;
    this.env = props.env ?? process.env;
    this.transport = props.transport;
    this.timeoutMs = props.timeoutMs;
    this.sessions = props.sessions;
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

  /**
   * The session a call reports to without `--session`: with a Jira ticket,
   * `<Claude Code session id>-<TICKET>`, the same row the heartbeat hook
   * keeps alive for a sub-agent on that ticket; without one, the Claude Code
   * session id. Undefined outside a Claude Code session.
   */
  defaultSession(ticket?: string): string | undefined {
    const value = this.env[claudeSessionEnv]?.trim();
    if (value === undefined || value === "") return undefined;
    const key = ticket !== undefined ? TicketKeySchema.safeParse(ticket) : undefined;
    return key?.success === true ? ticketSessionKey.key(value, key.data) : value;
  }

  /**
   * Whether a post would be sent: a token, enabled and a valid URL. Read by
   * the hooks before they start a child process; never touches the network.
   * The token is checked first because it is cheap, and reading the config
   * layers is not, so a machine without a token pays for neither.
   */
  reportable(): boolean {
    try {
      if (this.tokens.resolve() === undefined) return false;
      const settings = this.settings();
      return settings.enabled && settings.url !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Posts a heartbeat and remembers it for the session, so the heartbeat
   * hook can keep the session alive with the same ticket and step.
   */
  async heartbeat(input: BoardInput<HeartbeatInput>, options: BoardCallOptions = {}): Promise<BoardOutcome<HeartbeatResponse>> {
    return this.call(
      options,
      input.session,
      async (client, session) => {
        const sent = { ...input, session };
        try {
          const response = await client.heartbeat(sent);
          this.remember(sent, input.session === undefined);
          return response;
        } catch (err) {
          // A heartbeat that failed in transit still says what the run is doing.
          if (!(err instanceof AriadneError) || err.failure !== "invalid-input") this.remember(sent, input.session === undefined);
          throw err;
        }
      },
      input.ticket,
    );
  }

  /**
   * Re-sends the last heartbeat a skill posted for `session`, without
   * refreshing when it was recorded, or else the one the heartbeat hook
   * inferred for it. The heartbeat hook's liveness ping; a skill's heartbeat
   * always wins, so its step is never overwritten.
   */
  async replay(session: string, options: BoardCallOptions = {}): Promise<BoardOutcome<HeartbeatResponse>> {
    const record = this.sessions?.read(session) ?? this.sessions?.readInferred(session);
    if (record === undefined) return { status: "skipped", reason: "nothing-recorded" };
    return this.call(options, session, (client) => client.heartbeat(record.heartbeat), record.heartbeat.ticket);
  }

  /**
   * Posts an item. A session that has never sent a heartbeat (or has aged
   * out) gets one first, with step `started`, state `nominal` and the
   * reporting skill when one is named, and the item is posted again. A live
   * session's step is never overwritten this way.
   */
  async item(input: BoardInput<ItemInput>, options: BoardReportOptions = {}): Promise<BoardOutcome<ItemResponse>> {
    return this.call(
      options,
      input.session,
      (client, session) =>
        this.withSession(client, { session, ticket: input.ticket, skill: options.skill, defaulted: input.session === undefined }, () =>
          client.postItem({ ...input, session }),
        ),
      input.ticket,
    );
  }

  /** Posts one activity line, creating the session first as `item` does. */
  async activity(input: BoardInput<ActivityInput>, options: BoardReportOptions = {}): Promise<BoardOutcome<ActivityResponse>> {
    return this.call(
      options,
      input.session,
      (client, session) =>
        this.withSession(client, { session, ticket: input.ticket, skill: options.skill, defaulted: input.session === undefined }, () =>
          client.postActivity({ ...input, session }),
        ),
      input.ticket,
    );
  }

  /**
   * Every item of one of the caller's sessions, open and resolved, with any
   * chosen option. Without `session`, `ticket` picks the default session a
   * post on that ticket uses.
   */
  async items(
    session: string | undefined,
    options: BoardCallOptions = {},
    ticket?: string,
  ): Promise<BoardOutcome<ItemListResponse>> {
    return this.call(options, session, (client, id) => client.listItems(id), ticket);
  }

  /**
   * Remembering is best effort: a full disk must not fail a report. A
   * heartbeat sent to the default session also becomes the Claude Code
   * session's current skill session, which the heartbeat hook keeps alive.
   */
  private remember(heartbeat: HeartbeatInput, defaulted: boolean): void {
    try {
      this.sessions?.record(heartbeat);
      const claudeSession = this.defaultSession();
      if (defaulted && claudeSession !== undefined && claudeSession !== heartbeat.session) {
        this.sessions?.pointThread(claudeSession, heartbeat.session);
      }
    } catch {
      return;
    }
  }

  /**
   * Runs `post`, first creating the session when the API has none. A skill
   * heartbeat recorded for the session in the last hour, such as one that
   * failed in transit, creates it with its own step and state. Otherwise the
   * session starts as `started`, and when a skill is named that placeholder
   * is remembered as the skill's heartbeat, so the heartbeat hook keeps it
   * alive and never replaces its skill with an agent type it infers. The
   * placeholder never replaces a heartbeat a skill recorded meanwhile.
   */
  private async withSession<T>(client: AriadneClient, target: BootstrapTarget, post: () => Promise<T>): Promise<T> {
    try {
      return await post();
    } catch (err) {
      if (!(err instanceof AriadneError) || err.code !== "session_not_found") throw err;
    }
    const { session, ticket, skill, defaulted } = target;
    const recorded = this.bestEffort(() => this.sessions?.recent(session, bootstrapRecoveryMs));
    if (recorded !== undefined) {
      await client.heartbeat(recorded);
      return post();
    }
    const named = skill !== undefined && skill !== "";
    const heartbeat: HeartbeatInput = { session, ticket, step: bootstrapStep, state: "nominal", ...(named ? { skill } : {}) };
    await client.heartbeat(heartbeat);
    if (named) this.rememberPlaceholder(heartbeat, defaulted);
    return post();
  }

  private rememberPlaceholder(heartbeat: HeartbeatInput, defaulted: boolean): void {
    const remembered = this.bestEffort(() => this.sessions?.recordIfAbsent(heartbeat, bootstrapRecoveryMs));
    const claudeSession = this.defaultSession();
    if (remembered === true && defaulted && claudeSession !== undefined && claudeSession !== heartbeat.session) {
      this.bestEffort(() => this.sessions?.pointThread(claudeSession, heartbeat.session));
    }
  }

  /** Local state is best effort: a full or unreadable disk must not fail a report. */
  private bestEffort<R>(run: () => R): R | undefined {
    try {
      return run();
    } catch {
      return undefined;
    }
  }

  private async call<T>(
    options: BoardCallOptions,
    requestedSession: string | undefined,
    run: (client: AriadneClient, session: string) => Promise<T>,
    ticket?: string,
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
    // Ariadne maps tickets through Jira, so a GitHub-tracked run is skipped, not failed.
    if (ticket !== undefined && ticket !== "" && !TicketKeySchema.safeParse(ticket).success) {
      return {
        status: "skipped",
        reason: "not-jira-ticket",
        notices: [...settings.notices, `skipped: ${ticket} is not a Jira issue key, and Ariadne tracks only Jira tickets`],
      };
    }

    let token: string | undefined;
    try {
      token = this.tokens.resolve()?.token;
    } catch (err) {
      return noted({ status: "failed", message: err instanceof Error ? err.message : String(err) });
    }
    if (token === undefined && options.strict !== true) return noted({ status: "skipped", reason: "no-token" });

    const session = requestedSession ?? this.defaultSession(ticket);
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
