/** Where the token in use came from, never the token itself. */
export type AriadneTokenSource = "ARIADNE_AGENT_TOKEN" | "ARIADNE_TOKEN" | "file";
export interface ResolvedAriadneToken {
    token: string;
    source: AriadneTokenSource;
}
/** Checked in this order, before the saved file. */
export declare const ariadneTokenEnvNames: readonly ["ARIADNE_AGENT_TOKEN", "ARIADNE_TOKEN"];
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
export declare class AriadneTokenStore {
    private readonly env;
    private readonly home;
    constructor(props?: AriadneTokenStoreProps);
    isAgentToken(value: string): boolean;
    /** `$XDG_CONFIG_HOME/flight-rules/ariadne-token`, else `~/.config/flight-rules/ariadne-token`. */
    path(): string;
    resolve(): ResolvedAriadneToken | undefined;
    /** The environment variable that would win over a saved file, if one is set. */
    shadowingEnv(): AriadneTokenSource | undefined;
    /** Saves an agent token with mode 0600 and returns the path. Rejects anything that is not one. */
    save(token: string): string;
    /** Deletes the saved token; returns whether one existed. */
    remove(): boolean;
}
