import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../config-store.js";

describe("ConfigStore", () => {
  let root: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fr-config-store-"));
    home = join(root, "home");
    project = join(root, "project");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(project, ".claude"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const store = (env: Record<string, string | undefined> = {}): ConfigStore =>
    new ConfigStore({ cwd: project, home, env });

  const writeSettings = (path: string, options: Record<string, unknown>, key = "flight-rules@flight-rules"): void => {
    writeFileSync(path, JSON.stringify({ model: "opus", pluginConfigs: { [key]: { options } } }));
  };
  const userSettings = (): string => join(home, ".claude", "settings.json");
  const projectSettings = (): string => join(project, ".claude", "settings.json");
  const localSettings = (): string => join(project, ".claude", "settings.local.json");
  const configFile = (): string => join(project, ".claude", "flight-rules.local.md");

  const jiraShared = {
    tracker: "jira",
    jiraHost: "acme.atlassian.net",
    jiraEmail: "me@acme.com",
    jiraProject: "PROJ",
    inProgressStatus: "In Progress",
  };

  it("loads config from user settings alone", () => {
    writeSettings(userSettings(), jiraShared);
    const config = store().load();
    expect(config.tracker).toBe("jira");
    expect(config.inProgressStatus).toBe("In Progress");
  });

  it("merges key by key, with project over user, local over project, and the config file over all", () => {
    writeSettings(userSettings(), { ...jiraShared, repo: "acme/user" });
    writeSettings(projectSettings(), { repo: "acme/project", jiraProject: "TEAM" });
    writeSettings(localSettings(), { repo: "acme/local" });
    writeFileSync(configFile(), "---\ninReviewStatus: Review\n---\n");

    const report = store().report();
    expect(report.config).toMatchObject({
      jiraHost: "acme.atlassian.net",
      jiraProject: "TEAM",
      repo: "acme/local",
      inReviewStatus: "Review",
    });
    expect(report.sources["jiraHost"]?.scope).toBe("user");
    expect(report.sources["jiraProject"]?.scope).toBe("project");
    expect(report.sources["repo"]?.scope).toBe("local");
    expect(report.sources["inReviewStatus"]?.scope).toBe("file");
  });

  it("accepts a flight-rules plugin key from another marketplace", () => {
    writeSettings(userSettings(), jiraShared, "flight-rules@internal-mirror");
    expect(store().load().jiraProject).toBe("PROJ");
  });

  it("ignores other plugins' config", () => {
    writeSettings(userSettings(), jiraShared, "flight-rules-extras@market");
    expect(() => store().load()).toThrow("No flight-rules config found");
  });

  it("reads user settings from CLAUDE_CONFIG_DIR when set", () => {
    const relocated = join(root, "relocated");
    mkdirSync(relocated);
    writeSettings(join(relocated, "settings.json"), jiraShared);
    expect(store({ CLAUDE_CONFIG_DIR: relocated }).load().tracker).toBe("jira");
  });

  it("uses FLIGHT_RULES_CONFIG as the config file and fails when it is missing", () => {
    const elsewhere = join(root, "cfg.md");
    writeFileSync(elsewhere, "---\ntracker: github\nrepo: acme/elsewhere\n---\n");
    expect(store({ FLIGHT_RULES_CONFIG: elsewhere }).load().repo).toBe("acme/elsewhere");
    expect(() => store({ FLIGHT_RULES_CONFIG: join(root, "nope.md") }).load()).toThrow("does not exist");
  });

  it("names every place config can live when none is found", () => {
    expect(() => store().load()).toThrow(/settings\.json.*settings\.local\.json/);
  });

  it("reports invalid JSON in a settings file by path", () => {
    writeFileSync(userSettings(), "{ not json");
    expect(() => store().load()).toThrow(`${userSettings()} is not valid JSON`);
  });

  it("validates the merged config, not each layer", () => {
    writeSettings(userSettings(), { tracker: "jira", jiraHost: "acme.atlassian.net" });
    expect(() => store().load()).toThrow();
    writeSettings(localSettings(), { jiraEmail: "me@acme.com", jiraProject: "PROJ" });
    expect(store().load().jiraProject).toBe("PROJ");
  });

  describe("set", () => {
    it("writes into pluginConfigs and preserves the rest of the settings file", () => {
      writeSettings(userSettings(), jiraShared);
      store().set("inReviewStatus", ["Ready", "for", "Review"], "user");
      const written = JSON.parse(readFileSync(userSettings(), "utf-8")) as {
        model: string;
        pluginConfigs: Record<string, { options: Record<string, unknown> }>;
      };
      expect(written.model).toBe("opus");
      expect(written.pluginConfigs["flight-rules@flight-rules"]?.options).toMatchObject({
        jiraHost: "acme.atlassian.net",
        inReviewStatus: "Ready for Review",
      });
    });

    it("creates a missing settings file", () => {
      writeSettings(userSettings(), jiraShared);
      store().set("repo", ["acme/proj"], "local");
      expect(store().report().sources["repo"]?.scope).toBe("local");
    });

    it("keeps an existing non-default plugin key when writing", () => {
      writeSettings(userSettings(), jiraShared, "flight-rules@internal-mirror");
      store().set("repo", ["acme/proj"], "user");
      const written = JSON.parse(readFileSync(userSettings(), "utf-8")) as {
        pluginConfigs: Record<string, unknown>;
      };
      expect(Object.keys(written.pluginConfigs)).toEqual(["flight-rules@internal-mirror"]);
    });

    it("stores array keys as lists", () => {
      writeSettings(userSettings(), jiraShared);
      store().set("defaultLabels", ["platform", "agentic"], "user");
      expect(store().load().defaultLabels).toEqual(["platform", "agentic"]);
    });

    it("rewrites the config file frontmatter and keeps its body", () => {
      writeFileSync(configFile(), "---\ntracker: github\nrepo: acme/proj\n---\n\nNotes for humans.\n");
      store().set("defaultLabels", ["a", "b"], "file");
      const contents = readFileSync(configFile(), "utf-8");
      expect(contents).toContain("Notes for humans.");
      expect(store().load()).toMatchObject({ repo: "acme/proj", defaultLabels: ["a", "b"] });
    });

    it("rejects unknown keys and invalid values", () => {
      expect(() => store().set("jiraBoard", ["x"], "user")).toThrow('Unknown config key "jiraBoard"');
      expect(() => store().set("tracker", ["notion"], "user")).toThrow("Invalid value for tracker");
    });
  });

  describe("defaultScopeFor", () => {
    it("targets the scope that currently sets the key", () => {
      writeSettings(userSettings(), jiraShared);
      expect(store().defaultScopeFor("inProgressStatus")).toBe("user");
    });

    it("targets the config file for a new key when the file exists, else local", () => {
      writeSettings(userSettings(), jiraShared);
      expect(store().defaultScopeFor("repo")).toBe("local");
      writeFileSync(configFile(), "---\nrepo: acme/proj\n---\n");
      expect(store().defaultScopeFor("inReviewStatus")).toBe("file");
    });
  });

  it("reports a higher scope that shadows a write", () => {
    writeSettings(userSettings(), jiraShared);
    writeSettings(localSettings(), { inProgressStatus: "Doing" });
    expect(store().shadowingScope("inProgressStatus", "user")).toBe("local");
    expect(store().shadowingScope("inProgressStatus", "local")).toBeUndefined();
  });

  it("unsets a key from one scope", () => {
    writeSettings(userSettings(), jiraShared);
    writeSettings(localSettings(), { inProgressStatus: "Doing" });
    store().unset("inProgressStatus", "local");
    expect(store().load().inProgressStatus).toBe("In Progress");
  });
});
