import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport } from "../../../usage-handoff/agent-transport.js";
import type { UsageHandoffHook } from "../../../usage-handoff/usage-handoff.js";
import { createHookCommand } from "../../hook/command.js";
import { createHandoffCommand } from "../command.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("hook usage-handoff", () => {
  const run = async (stdin: string, handle: UsageHandoffHook["handle"], args: string[] = ["--harness", "codex"]) => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createHookCommand(
      undefined,
      () => Promise.resolve(stdin),
      undefined,
      () => ({ handle }) as UsageHandoffHook,
    ).parseAsync(["usage-handoff", ...args], { from: "user" });
    return output.mock.calls.map(([chunk]) => String(chunk)).join("");
  };

  it("prints the hook's reply as JSON and passes the harness", async () => {
    const handle = vi.fn(async () => ({ decision: "block" as const, reason: "write it" }));

    const out = await run(JSON.stringify({ session_id: "s1" }), handle);

    expect(JSON.parse(out)).toEqual({ decision: "block", reason: "write it" });
    expect(handle).toHaveBeenCalledWith("codex", { session_id: "s1" });
  });

  it("prints nothing when the hook has nothing to say", async () => {
    expect(await run("{}", async () => undefined)).toBe("");
  });

  it("never throws, even on bad input or a failing hook", async () => {
    expect(await run("{not json", async () => undefined)).toBe("");
    expect(await run("{}", () => Promise.reject(new Error("boom")))).toBe("");
    expect(await run("{}", async () => undefined, ["--harness", "gemini"])).toBe("");
  });
});

describe("handoff wait", () => {
  it("runs the waiter against the transport", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-03T14:00:00Z"));
    const send = vi.fn(async () => {});
    const transport = { send } as unknown as AgentTransport;

    const done = createHandoffCommand(() => transport).parseAsync(
      ["wait", "--origin", "t1", "--at", String(Date.parse("2026-11-03T14:00:00Z")), "--harness", "claude-code"],
      { from: "user" },
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await done;

    expect(send).toHaveBeenCalledWith("t1", expect.stringContaining("Usage has reset"));
  });

  it("exits quietly on invalid options", async () => {
    const send = vi.fn();
    await createHandoffCommand(() => ({ send }) as unknown as AgentTransport).parseAsync(
      ["wait", "--origin", "t1", "--at", "soon"],
      { from: "user" },
    );
    expect(send).not.toHaveBeenCalled();
  });
});
