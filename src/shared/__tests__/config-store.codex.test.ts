import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../config-store.js";
import { NeutralSettingsSource } from "../host-settings/neutral-settings-source.js";

describe("Codex configuration", () => {
  let root: string;
  let cwd: string;
  let home: string;
  const store = (): ConfigStore => new ConfigStore({ cwd, home, env: { FLIGHT_RULES_HOST: "codex" } });
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fr-codex-settings-"));
    cwd = join(root, "project"); home = join(root, "home");
    mkdirSync(cwd); mkdirSync(home);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports the selected host and writes only neutral paths", () => {
    const config = store();
    expect(config.inspect().host).toBe("codex");
    expect(config.filePath()).toBe(join(cwd, ".agents/flight-rules.local.md"));
    config.set("tracker", ["github"], "user");
    config.set("repo", ["acme/project"], "project");
    config.set("repo", ["acme/local"], "local");
    expect(config.load().repo).toBe("acme/local");
    expect(config.report().sources["tracker"]?.path).toBe(join(home, ".agents/flight-rules.settings.json"));
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(join(cwd, ".codex"))).toBe(false);
  });

  it("retains legacy file precedence without silently migrating settings", () => {
    mkdirSync(join(cwd, ".claude"));
    const legacy = join(cwd, ".claude/flight-rules.local.md");
    const contents = "---\ntracker: github\nrepo: acme/legacy\n---\noriginal body\n";
    writeFileSync(legacy, contents);
    store().set("repo", ["acme/new"], "project");
    expect(store().load().repo).toBe("acme/legacy");
    expect(store().shadowingScope("repo", "project")).toBe("file");
    expect(readFileSync(legacy, "utf8")).toBe(contents);
  });

  it("preserves unrelated neutral values when setting and unsetting a key", () => {
    const source = new NeutralSettingsSource({ cwd, home });
    source.write("project", () => ({ custom: { retained: true }, repo: "acme/original" }));
    store().set("repo", ["acme/new"], "project");
    store().unset("repo", "project");
    expect(source.read("project")).toEqual({ custom: { retained: true } });
  });

  it("uses the main checkout for absent untracked layers, then prefers worktree-local overrides", () => {
    const worktree = join(root, "worktree"); mkdirSync(worktree);
    store().set("tracker", ["github"], "user");
    store().set("repo", ["acme/main"], "local");
    const linked = new ConfigStore({ cwd: worktree, home, env: {}, host: "codex", untrackedRoot: cwd });
    expect(linked.load().repo).toBe("acme/main");
    linked.set("repo", ["acme/updated"], "local");
    expect(store().load().repo).toBe("acme/updated");
    new NeutralSettingsSource({ cwd: worktree, home }).write("local", () => ({ repo: "acme/branch" }));
    expect(linked.load().repo).toBe("acme/branch");
  });

  it("rejects an unknown host before writing and lets explicit host override environment", () => {
    expect(() => new ConfigStore({ cwd, home, env: { FLIGHT_RULES_HOST: "typo" } })).toThrow();
    expect(new ConfigStore({ cwd, home, env: { FLIGHT_RULES_HOST: "codex" }, host: "claude" }).inspect().host).toBe("claude");
  });

  it("fails on malformed neutral settings without overwriting them", () => {
    const source = new NeutralSettingsSource({ cwd, home });
    mkdirSync(join(cwd, ".agents"));
    writeFileSync(source.pathFor("project"), "not-json");
    expect(() => store().set("repo", ["acme/new"], "project")).toThrow(/Invalid flight-rules settings/);
    expect(readFileSync(source.pathFor("project"), "utf8")).toBe("not-json");
  });
});
