import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AriadneTokenStore } from "../ariadne-token-store.js";
import { agentToken } from "./fake-transport.js";

describe("AriadneTokenStore", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-ariadne-token-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const store = (env: Record<string, string | undefined> = {}) => new AriadneTokenStore({ env, home });

  it("keeps the token in the user's flight-rules config directory", () => {
    expect(store().path()).toBe(join(home, ".config", "flight-rules", "ariadne-token"));
    expect(store({ XDG_CONFIG_HOME: join(home, "xdg") }).path()).toBe(join(home, "xdg", "flight-rules", "ariadne-token"));
  });

  it("finds nothing when no variable or file is set", () => {
    expect(store({ ARIADNE_AGENT_TOKEN: "  " }).resolve()).toBeUndefined();
  });

  it("prefers $ARIADNE_AGENT_TOKEN, then $ARIADNE_TOKEN, then the saved file", () => {
    store().save(agentToken);
    expect(store().resolve()).toEqual({ token: agentToken, source: "file" });
    expect(store({ ARIADNE_TOKEN: "interactive.jwt" }).resolve()).toEqual({ token: "interactive.jwt", source: "ARIADNE_TOKEN" });
    expect(store({ ARIADNE_TOKEN: "interactive.jwt", ARIADNE_AGENT_TOKEN: "agent" }).resolve()).toEqual({
      token: "agent",
      source: "ARIADNE_AGENT_TOKEN",
    });
  });

  it("saves an agent token with mode 0600", () => {
    const path = store().save(`  ${agentToken}\n`);
    expect(readFileSync(path, "utf-8")).toBe(`${agentToken}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("tightens an existing file to 0600", () => {
    const path = store().path();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "old", { mode: 0o644 });
    store().save(agentToken);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses anything that is not an agent token, without echoing it", () => {
    const secret = "eyJhbGciOiJSUzI1NiJ9.not-an-agent-token";
    expect(() => store().save(secret)).toThrow("not an Ariadne agent token");
    expect(() => store().save(secret)).not.toThrow(secret);
    expect(() => store().save(`ariadne_agent_0123456789ABCDEF_${"A".repeat(43)}`)).toThrow();
    expect(() => store().save(`ariadne_agent_0123456789abcdef_${"A".repeat(42)}`)).toThrow();
  });

  it("reports which variable shadows a saved token", () => {
    expect(store().shadowingEnv()).toBeUndefined();
    expect(store({ ARIADNE_TOKEN: "x" }).shadowingEnv()).toBe("ARIADNE_TOKEN");
  });

  it("removes the saved token", () => {
    expect(store().remove()).toBe(false);
    store().save(agentToken);
    expect(store().remove()).toBe(true);
    expect(store().resolve()).toBeUndefined();
  });
});
