import { describe, it, expect, vi } from "vitest";
import { ConfigStore } from "../../../config-store.js";
import { createConfigCommand } from "../command.js";

describe("config path command", () => {
  it("prints only the supplied config path", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await createConfigCommand(() => new ConfigStore({ cwd: "/repo", env: { FLIGHT_RULES_CONFIG: "/repo/.agents/flight-rules.local.md" } }))
        .parseAsync(["path"], { from: "user" });
      expect(output).toHaveBeenCalledExactlyOnceWith("/repo/.agents/flight-rules.local.md\n");
    } finally {
      output.mockRestore();
    }
  });
});
