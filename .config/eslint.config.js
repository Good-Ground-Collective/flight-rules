import js from "@eslint/js";
import preflight from "@good-ground-collective/preflight";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Restates preflight's `naming-convention` entries — a rule's options replace
// rather than merge, so adding the Schema carve-out means re-declaring every
// entry preflight ships alongside it. Split in two so the test override can
// drop the object-literal half without repeating the identifier half.
const identifierNaming = [
  {
    selector: "variableLike",
    filter: { regex: "^(NULL_|UNKNOWN_)", match: true },
    format: ["UPPER_CASE"],
    prefix: ["NULL_", "UNKNOWN_"],
  },
  {
    // Zod schemas (and similar declarative value constructors) carry the
    // type-shape they describe, so PascalCase with a `Schema` suffix reads
    // naturally alongside the `z.infer<typeof FooSchema>` type export. Scoped
    // to the suffix via regex so plain PascalCase variable names remain
    // rejected. Not in preflight — this is the one local addition.
    selector: "variable",
    format: ["PascalCase"],
    filter: { regex: "Schema$", match: true },
  },
  {
    selector: "variableLike",
    format: ["camelCase"],
    filter: { regex: "^(?!NULL_|UNKNOWN_).*", match: true },
    leadingUnderscore: "allow",
  },
  { selector: "typeLike", format: ["PascalCase"] },
  { selector: "classProperty", modifiers: ["static"], format: ["UPPER_CASE"] },
  {
    selector: "interface",
    format: ["PascalCase"],
    custom: { regex: "^I[A-Z]", match: false },
  },
];

const objectLiteralNaming = [
  { selector: "objectLiteralProperty", modifiers: ["requiresQuotes"], format: null },
  { selector: "objectLiteralProperty", format: ["camelCase"] },
];

export default defineConfig([
  // `bin/` is the esbuild bundle and `vitest.config.ts` is excluded from
  // tsconfig, so the project service can't type it.
  globalIgnores([
    "**/dist",
    "**/node_modules",
    "**/storybook-static",
    "bin/**",
    "vitest.config.ts",
  ]),

  // The org charter rules. `recommended` = the `go-no-go` blocking gate plus the
  // fuzzier extras; it registers the preflight/@typescript-eslint/unicorn/import-x
  // plugins, scopes itself to **/*.ts + **/*.tsx, and sets the TS parser.
  //
  // It already carries `member-ordering` and `no-explicit-any` verbatim as we had
  // them, so those are gone from the local block below.
  ...preflight.configs.recommended,

  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-aware assertion bans — not in preflight, and they need the
      // projectService wired above.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
        },
      ],

      "@typescript-eslint/naming-convention": [
        "error",
        ...identifierNaming,
        ...objectLiteralNaming,
      ],
    },
  },

  // Test-file carve-outs. Tests describe a contract rather than ship behaviour,
  // so the idioms the charter bans in source are load-bearing here: arrange
  // helpers live at module scope, fixtures name fake tickets, and mock DI
  // containers are keyed by the class name they stand in for.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "preflight/no-loose-functions": "off",
      "preflight/no-planning-identifiers": "off",
      "@typescript-eslint/naming-convention": ["error", ...identifierNaming],
    },
  },
]);
