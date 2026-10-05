import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../config-store.js";
import type { HostSettingsSource, SettingsScope } from "../host-settings/host-settings-source.js";

/** An in-memory host, standing in for any non-Claude adapter. */
class MemoryHost implements HostSettingsSource {
  readonly host = "memory";
  readonly layers: Partial<Record<SettingsScope, Record<string, unknown>>> = {};

  pathFor(scope: SettingsScope): string {
    return `memory://${scope}`;
  }

  read(scope: SettingsScope): Record<string, unknown> | undefined {
    return this.layers[scope];
  }

  write(scope: SettingsScope, update: (values: Record<string, unknown>) => Record<string, unknown>): void {
    this.layers[scope] = update(this.layers[scope] ?? {});
  }

  hint(): string {
    return "add values to the memory host";
  }
}

describe("ConfigStore host seam", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fr-config-host-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("merges and writes through a non-Claude host source", () => {
    const host = new MemoryHost();
    host.layers.user = { tracker: "github", repo: "acme/user" };
    const store = new ConfigStore({ cwd: root, env: {}, hostSettings: host });
    store.set("repo", ["acme/local"], "local");
    expect(host.layers.local).toEqual({ repo: "acme/local" });
    expect(store.report().sources["repo"]).toEqual({ scope: "local", path: "memory://local" });
    expect(store.load().repo).toBe("acme/local");
  });

  it("names the host's own hint when nothing is configured", () => {
    const store = new ConfigStore({ cwd: root, env: {}, hostSettings: new MemoryHost() });
    expect(() => store.load()).toThrow("add values to the memory host");
  });

  it("reads the file layer from .agents when that is where config path points", () => {
    mkdirSync(join(root, ".agents"));
    writeFileSync(join(root, ".agents", "flight-rules.local.md"), "---\ntracker: github\nrepo: acme/agents\n---\n");
    const store = new ConfigStore({ cwd: root, env: {}, hostSettings: new MemoryHost() });
    expect(store.filePath()).toBe(join(root, ".agents", "flight-rules.local.md"));
    expect(store.report().sources["repo"]?.scope).toBe("file");
  });

  it("resolves a relative FLIGHT_RULES_CONFIG against cwd", () => {
    const store = new ConfigStore({ cwd: root, env: { FLIGHT_RULES_CONFIG: "cfg/fr.md" }, hostSettings: new MemoryHost() });
    expect(store.filePath()).toBe(join(root, "cfg", "fr.md"));
  });
});
