import js from "@eslint/js";
import preflight from "@good-ground-collective/preflight";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

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
  // It already carries `member-ordering`, `no-explicit-any` and the whole
  // `naming-convention` policy — including the Schema/Validator PascalCase
  // carve-out — so none of those are restated locally.
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
      // `create<Name>Command` and `buildProgram` are declarative constructors
      // that hand back a configured Commander object — the same category as the
      // built-in Schema/Validator suffixes, not behaviour hiding outside a
      // service. The rule matches on the binding name, so a factory whose name
      // does not end this way (buildTracker, buildPrHost) is not covered.
      "preflight/no-loose-functions": [
        "error",
        { allowedSuffixes: ["Command", "Program"] },
      ],

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
    },
  },

  // Test-file carve-outs. Tests describe a contract rather than ship behaviour,
  // so the idioms the charter bans in source are load-bearing here: arrange
  // helpers live at module scope, fixtures name fake tickets, mock DI
  // containers are keyed by the class name they stand in for, a stubbed
  // dependency's whole body is often a `throw`, and a suite is worth a
  // paragraph describing the contract it pins.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "preflight/no-loose-functions": "off",
      "preflight/no-planning-identifiers": "off",
      "preflight/no-throw-helpers": "off",
      "preflight/no-paragraph-comments": "off",
    },
  },
]);
