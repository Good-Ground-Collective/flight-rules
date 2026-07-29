import { describe, it, expect } from "vitest";
import { EnvLoader } from "../env.js";

describe("EnvLoader", () => {
  it("extracts the primary credential variables", () => {
    const env = new EnvLoader().load({
      GITHUB_TOKEN: "gh",
      JIRA_TOKEN: "jt",
      JIRA_EMAIL: "me@acme.com",
      JIRA_HOST: "acme.atlassian.net",
    });
    expect(env).toEqual({
      githubToken: "gh",
      jiraToken: "jt",
      jiraEmail: "me@acme.com",
      jiraHost: "acme.atlassian.net",
    });
  });

  it("falls back to JIRA_API_TOKEN then JIRA_API_KEY for the jira token", () => {
    expect(
      new EnvLoader().load({ JIRA_API_TOKEN: "from-api-token" }).jiraToken,
    ).toBe("from-api-token");
    expect(
      new EnvLoader().load({ JIRA_API_KEY: "from-api-key" }).jiraToken,
    ).toBe("from-api-key");
  });

  it("prefers JIRA_TOKEN over its aliases", () => {
    expect(
      new EnvLoader().load({
        JIRA_TOKEN: "primary",
        JIRA_API_TOKEN: "alias",
        JIRA_API_KEY: "alias2",
      }).jiraToken,
    ).toBe("primary");
  });

  it("leaves credentials undefined when nothing is set", () => {
    expect(new EnvLoader().load({})).toEqual({});
  });

  it("normalizes a full-URL JIRA_HOST to a bare domain", () => {
    expect(
      new EnvLoader().load({ JIRA_HOST: "https://acme.atlassian.net/" })
        .jiraHost,
    ).toBe("acme.atlassian.net");
    expect(
      new EnvLoader().load({ JIRA_HOST: "http://acme.atlassian.net" }).jiraHost,
    ).toBe("acme.atlassian.net");
    expect(
      new EnvLoader().load({ JIRA_HOST: "acme.atlassian.net" }).jiraHost,
    ).toBe("acme.atlassian.net");
  });

  describe("supports optional overrides and construction time", () => {
    it("overriding source values even if they exist", () => {
      const loader = new EnvLoader({ jiraEmail: "angell.seth@seth.com" });

      const env = loader.load({
        GITHUB_TOKEN: "gh",
        JIRA_TOKEN: "jt",
        JIRA_EMAIL: "me@acme.com",
        JIRA_HOST: "acme.atlassian.net",
      });

      expect(env.jiraEmail).not.toBe("me@acme.com");
      expect(env.jiraEmail).toBe("angell.seth@seth.com");
    });
  });
});
