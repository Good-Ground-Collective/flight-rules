import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist", "**/node_modules", "**/storybook-static"]),
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
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variableLike",
          format: ["UPPER_CASE"],
          prefix: ["NULL_", "UNKNOWN_"],
        },
        {
          // Zod schemas (and similar declarative value constructors) carry the
          // type-shape they describe, so PascalCase with a `Schema` suffix
          // reads naturally alongside the `z.infer<typeof FooSchema>` type
          // export. Scoped to the suffix via regex so plain PascalCase variable
          // names remain rejected.
          selector: "variable",
          format: ["PascalCase"],
          filter: { regex: "Schema$", match: true },
        },
        {
          // React Context objects produced by `createContext()` are PascalCase
          // by community convention (`const AuthContext = createContext(...)`),
          // and downstream `<AuthContext.Provider>` JSX requires PascalCase to
          // parse as a component. Scoped to the `Context` suffix so other
          // PascalCase variables remain rejected.
          selector: "variable",
          format: ["PascalCase"],
          filter: { regex: "Context$", match: true },
        },
        {
          // React function components are PascalCase by framework convention,
          // and JSX requires PascalCase to distinguish components from host
          // elements. Scoped via filter so only function names that start with
          // an uppercase letter (i.e. components) get the PascalCase allowance;
          // utility functions still have to be camelCase.
          selector: "function",
          format: ["PascalCase"],
          filter: { regex: "^[A-Z]", match: true },
        },
        {
          selector: "function",
          format: ["camelCase"],
          filter: { regex: "^[A-Z]", match: false },
          leadingUnderscore: "allow",
        },
        {
          selector: "variableLike",
          format: ["camelCase"],
          filter: {
            regex: "^(?!NULL_|UNKNOWN_).*(?<!Schema)(?<!Context)$",
            match: true,
          },
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "classProperty",
          modifiers: ["static"],
          format: ["UPPER_CASE"],
        },
      ],
      "@typescript-eslint/member-ordering": [
        "error",
        {
          default: {
            memberTypes: [
              "signature",
              "public-instance-field",
              "protected-instance-field",
              "private-instance-field",
              "constructor",
              "public-instance-method",
              "protected-instance-method",
              "private-instance-method",
              "public-static-field",
              "protected-static-field",
              "private-static-field",
            ],
            order: "as-written",
          },
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
    },
  },
]);
