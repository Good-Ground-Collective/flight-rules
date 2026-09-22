import { describe, it, expect, vi } from "vitest";
import { createConfigCommand } from "../command.js";

describe("config path command", () => {
  it("prints only the supplied config path", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await createConfigCommand(() => "/repo/.agents/flight-rules.local.md")
        .parseAsync(["path"], { from: "user" });
      expect(output).toHaveBeenCalledExactlyOnceWith("/repo/.agents/flight-rules.local.md\n");
    } finally {
      output.mockRestore();
    }
  });
});
