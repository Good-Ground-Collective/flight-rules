/** The settings scopes a host provides, lowest precedence first. */
export const settingsScopes = ["user", "project", "local"] as const;
export type SettingsScope = (typeof settingsScopes)[number];

/**
 * Where a host keeps flight-rules values in its own settings files. The
 * config store merges these layers under the flight-rules config file; each
 * host adapter supplies its own source, so the store itself never names a
 * host.
 */
export interface HostSettingsSource {
  /** Short host name, for messages. */
  readonly host: string;
  pathFor(scope: SettingsScope): string;
  /** The flight-rules values at `scope`, or undefined when that layer holds none. */
  read(scope: SettingsScope): Record<string, unknown> | undefined;
  write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void;
  /** One sentence telling a person where to put values for this host. */
  hint(): string;
}
