import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileModelTierCatalog,
  ModelTiersUnavailableError,
  claudeModelTiers,
} from "../model-tiers.js";

describe("FileModelTierCatalog", () => {
  it("loads the shipped Claude tier table from the package home", () => {
    expect(claudeModelTiers.load()).toEqual({
      standard: "sonnet",
      escalated: "opus",
      expert: "fable",
    });
  });

  it("honors the installation home override and validates the table", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-tiers-"));
    mkdirSync(join(home, "adapters", "claude"), { recursive: true });
    const file = join(home, "adapters", "claude", "model-tiers.json");

    writeFileSync(file, JSON.stringify({ standard: "a", escalated: "b", expert: "c" }));
    const catalog = new FileModelTierCatalog({
      moduleUrl: import.meta.url,
      env: { FLIGHT_RULES_HOME: home },
    });
    expect(catalog.load()).toEqual({ standard: "a", escalated: "b", expert: "c" });

    writeFileSync(file, JSON.stringify({ standard: "a" }));
    expect(() => catalog.load()).toThrow(ModelTiersUnavailableError);
    writeFileSync(file, "not json");
    expect(() => catalog.load()).toThrow(ModelTiersUnavailableError);
  });
});
