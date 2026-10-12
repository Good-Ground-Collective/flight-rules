import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = new URL("../../dist/", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("built library smoke test", () => {
  it("resolves the package in Node with the release version and working services", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { appVersion, createFlightRules } from '@good-ground-collective/flight-rules'
      import pkg from '@good-ground-collective/flight-rules/package.json' with { type: 'json' }
      const core = createFlightRules({ cwd: '/nonexistent', env: {} })
      console.log(JSON.stringify({
        appVersion,
        packageVersion: pkg.version,
        doc: core.docs().resolve('coding-charter').id,
        git: typeof core.git().checkout,
      }))
    `,
      ],
      { cwd: root, encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual({
      appVersion: pkg.version,
      packageVersion: pkg.version,
      doc: "coding-charter",
      git: "function",
    });
  });

  it("keeps dependency imports external to the ESM bundle", () => {
    const bundle = readFileSync(new URL("index.js", dist), "utf8");
    expect(bundle).toMatch(/from ["']zod["']/);
    expect(bundle).not.toContain("node_modules/");
    expect(bundle).not.toContain("class ZodError");
  });

  it("imports the review entry and schemas by package name", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { FileReviewPolicy, reviewContract } from '@good-ground-collective/flight-rules/review'
      import full from '@good-ground-collective/flight-rules/review/schema' with { type: 'json' }
      import transport from '@good-ground-collective/flight-rules/review/transport-schema' with { type: 'json' }
      console.log(JSON.stringify({
        policy: new FileReviewPolicy().load().method.includes('fix, clarify and decide'),
        full: JSON.stringify(full) === JSON.stringify(reviewContract.schemas().full),
        transport: JSON.stringify(transport) === JSON.stringify(reviewContract.schemas().transport),
      }))
    `,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({ policy: true, full: true, transport: true });
  });

  it("ships declarations without test declarations", () => {
    expect(readFileSync(new URL("index.d.ts", dist), "utf8")).toContain("createFlightRules");
    expect(
      readdirSync(dist, { recursive: true }).some((path) => String(path).includes("__tests__")),
    ).toBe(false);
  });

  it("exposes the library, review contract and package metadata entry points", () => {
    expect(pkg.main).toBeUndefined();
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./package.json": "./package.json",
      "./review": { types: "./dist/code-review/index.d.ts", import: "./dist/review.js" },
      "./review/schema": "./contracts/code-review/review.v1.schema.json",
      "./review/transport-schema": "./contracts/code-review/review.v1.transport.schema.json",
    });
    expect(pkg.files).toContain("dist/");
    expect(pkg.bin).toEqual({ "flight-rules": "bin/flight-rules.mjs" });
  });
});
