import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileNativeInstallation, NativeInstallationError } from "../native-installation.js";

describe("native agent installation", () => {
  let scratch: string;
  let root: string;
  let cwd: string;
  let home: string;
  const contents = 'name = "worker"\ndescription = "A worker"\ndeveloper_instructions = "Read the task."\n';
  const writeBundle = (): void => {
    mkdirSync(join(root, ".codex/agents"), { recursive: true });
    writeFileSync(join(root, ".codex/agents/worker.toml"), contents);
    writeFileSync(join(root, "flight-rules-install.json"), JSON.stringify({ host: "codex", agents: [{ name: "worker", registration: { name: "worker", description: "A worker", capabilities: ["read"], model: "standard" }, sha256: createHash("sha256").update(contents).digest("hex") }] }));
  };
  const installation = (): FileNativeInstallation => new FileNativeInstallation({ root, cwd, home });

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "fr-native-install-"));
    root = join(scratch, "plugin");
    cwd = join(scratch, "project");
    home = join(scratch, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    writeBundle();
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it("checks without mutation and copies missing files idempotently", () => {
    const native = installation();
    expect(native.host()).toBe("codex");
    expect(native.status("project")).toMatchObject({ ok: false, evidence: "files-only", agents: [{ name: "worker", status: "missing" }] });
    expect(existsSync(join(cwd, ".codex"))).toBe(false);
    const first = native.install("project");
    expect(first).toMatchObject({ ok: true, agents: [{ status: "present" }] });
    expect(native.install("project")).toEqual(first);
    expect(readFileSync(join(cwd, ".codex/agents/worker.toml"), "utf8")).toBe(contents);
    expect(existsSync(join(cwd, ".codex/config.toml"))).toBe(false);
  });

  it("uses CODEX_HOME only for user registrations", () => {
    const native = new FileNativeInstallation({ root, cwd, home, env: { CODEX_HOME: join(scratch, "custom-codex") } });
    expect(native.install("user").directory).toBe(join(scratch, "custom-codex/agents"));
    expect(native.status("project").ok).toBe(false);
    expect(existsSync(join(home, ".codex"))).toBe(false);
  });

  it("preserves unrelated agents and host settings", () => {
    mkdirSync(join(cwd, ".codex/agents"), { recursive: true });
    writeFileSync(join(cwd, ".codex/agents/other.toml"), "other");
    writeFileSync(join(cwd, ".codex/config.toml"), "existing-settings");
    installation().install("project");
    expect(readFileSync(join(cwd, ".codex/agents/other.toml"), "utf8")).toBe("other");
    expect(readFileSync(join(cwd, ".codex/config.toml"), "utf8")).toBe("existing-settings");
  });

  it("refuses a differing definition before installing anything", () => {
    mkdirSync(join(cwd, ".codex/agents"), { recursive: true });
    writeFileSync(join(cwd, ".codex/agents/worker.toml"), "customized");
    expect(installation().status("project").agents[0]?.status).toBe("conflict");
    expect(() => installation().install("project")).toThrow(/Existing agent definitions differ/);
    expect(readFileSync(join(cwd, ".codex/agents/worker.toml"), "utf8")).toBe("customized");
  });

  it.each([".codex", ".codex/agents", ".codex/agents/worker.toml"])("refuses a symlink at %s", (path) => {
    mkdirSync(join(cwd, ".codex/agents"), { recursive: true });
    rmSync(join(cwd, path), { recursive: true, force: true });
    symlinkSync(join(scratch, "outside"), join(cwd, path));
    expect(() => installation().install("project")).toThrow(/symlinked/);
    expect(existsSync(join(scratch, "outside"))).toBe(false);
  });

  it("rejects a changed bundle before creating destination directories", () => {
    writeFileSync(join(root, ".codex/agents/worker.toml"), "changed");
    expect(() => installation().install("project")).toThrow(/Bundled registration/);
    expect(existsSync(join(cwd, ".codex"))).toBe(false);
  });

  it("rejects invalid manifests without reproducing their contents", () => {
    writeFileSync(join(root, "flight-rules-install.json"), '{"secret":"do-not-print"}');
    expect(() => installation().host()).toThrow(NativeInstallationError);
    expect(() => installation().host()).toThrow(/Invalid installation manifest/);
    expect(() => installation().host()).not.toThrow(/do-not-print/);
  });

  it("finds registrations in the full npm package", () => {
    rmSync(join(root, "flight-rules-install.json"));
    root = join(root, "dist/codex");
    writeBundle();
    const native = new FileNativeInstallation({ root: join(scratch, "plugin"), cwd, home });
    expect(native.host()).toBeUndefined();
    expect(native.install("project").ok).toBe(true);
  });

  it("does not mistake a Claude package for a Codex registration source", () => {
    const path = join(root, "flight-rules-install.json");
    writeFileSync(path, readFileSync(path, "utf8").replace('"codex"', '"claude"'));
    expect(installation().host()).toBe("claude");
    expect(() => installation().install("project")).toThrow(/Claude discovers agents/);
  });
});
