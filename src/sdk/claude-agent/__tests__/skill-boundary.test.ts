import { describe, expect, it } from "vitest";
import { ToolTurnObserver } from "../skill-boundary.js";

const assistant = (turnId: string, id: string, name: string, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { id: turnId, content: [{ type: "tool_use", id, name, input: {} }] },
});

describe("tool turn observer", () => {
  it("groups the calls of one assistant turn and waits for a call that has not arrived", async () => {
    const turns = new ToolTurnObserver();
    const pending = turns.turnOf("b");

    turns.observe(assistant("turn-1", "a", "first"));
    turns.observe(assistant("turn-1", "b", "second"));

    await expect(pending).resolves.toEqual([
      { id: "a", name: "first" },
      { id: "b", name: "second" },
    ]);
  });

  it("ignores subagent turns and non-assistant messages, and releases waiters when closed", async () => {
    const turns = new ToolTurnObserver();
    turns.observe(assistant("turn-1", "sub", "inner", "parent-call"));
    turns.observe({ type: "result" });
    const pending = turns.turnOf("sub");

    turns.close();

    await expect(pending).resolves.toBeUndefined();
  });
});
