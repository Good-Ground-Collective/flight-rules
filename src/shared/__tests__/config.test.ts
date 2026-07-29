import { describe, it, expect } from "vitest";
import { readConfig, getRfcDir, seedCompetencies } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";

const setupFixture = (content: string): string => {
  const dir = join(tmpdir(), `flight-rules-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "flight-rules.local.md");
  writeFileSync(filePath, content);
  return filePath;
};

describe("readConfig", () => {
  it("parses a valid github config", () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
defaultLabels:
  - engineering
---
`);
    const config = readConfig(filePath);
    expect(config.tracker).toBe("github");
    expect(config.repo).toBe("acme/my-project");
    expect(config.defaultLabels).toEqual(["engineering"]);
  });

  it("defaults defaultLabels to empty array when omitted", () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
---
`);
    const config = readConfig(filePath);
    expect(config.defaultLabels).toEqual([]);
  });

  it("throws ZodError for invalid tracker value", () => {
    const filePath = setupFixture(`---
tracker: notion
repo: acme/my-project
---
`);
    expect(() => readConfig(filePath)).toThrow();
  });

  it("defaults competencies to the seed set when omitted", () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
---
`);
    const config = readConfig(filePath);
    expect(config.competencies).toEqual([...seedCompetencies]);
  });

  it("parses a competencies override", () => {
    const filePath = setupFixture(`---
tracker: github
repo: acme/my-project
competencies:
  - custom-thing
  - another-thing
---
`);
    const config = readConfig(filePath);
    expect(config.competencies).toEqual(["custom-thing", "another-thing"]);
  });

  it("parses a valid jira config without a repo", () => {
    const filePath = setupFixture(`---
tracker: jira
jiraHost: acme.atlassian.net
jiraEmail: me@acme.com
jiraProject: PROJ
jpdProject: DISC
---
`);
    const config = readConfig(filePath);
    expect(config.tracker).toBe("jira");
    expect(config.jiraHost).toBe("acme.atlassian.net");
    expect(config.jiraEmail).toBe("me@acme.com");
    expect(config.jiraProject).toBe("PROJ");
    expect(config.jpdProject).toBe("DISC");
    expect(config.repo).toBeUndefined();
  });

  it("normalizes a full-URL jiraHost to a bare domain", () => {
    const filePath = setupFixture(`---
tracker: jira
jiraHost: https://acme.atlassian.net/
jiraEmail: me@acme.com
jiraProject: PROJ
---
`);
    expect(readConfig(filePath).jiraHost).toBe("acme.atlassian.net");
  });

  it("rejects a jira config missing jiraProject", () => {
    const filePath = setupFixture(`---
tracker: jira
jiraHost: acme.atlassian.net
jiraEmail: me@acme.com
---
`);
    expect(() => readConfig(filePath)).toThrow();
  });

  it("rejects a github config missing repo", () => {
    const filePath = setupFixture(`---
tracker: github
---
`);
    expect(() => readConfig(filePath)).toThrow();
  });
});

const base: Config = {
  tracker: "github",
  repo: "acme/proj",
  defaultLabels: [],
  rfcStorage: "local",
  competencies: [],
};

describe("getRfcDir", () => {
  it("returns <cwd>/rfcs for local storage", () => {
    expect(getRfcDir(base, "/workspace")).toBe("/workspace/rfcs");
  });

  it("returns rfcStoragePath for global storage", () => {
    const config: Config = {
      ...base,
      rfcStorage: "global",
      rfcStoragePath: "/shared/rfcs",
    };
    expect(getRfcDir(config, "/workspace")).toBe("/shared/rfcs");
  });

  it("throws when global storage has no path configured", () => {
    const config: Config = { ...base, rfcStorage: "global" };
    expect(() => getRfcDir(config, "/workspace")).toThrow(
      "rfcStoragePath is required",
    );
  });
});
