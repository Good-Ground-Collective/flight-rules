---
language: typescript
applies-to:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
---

# Code Standards: TypeScript

These mandates apply to TypeScript files, in addition to the core charter. They keep the `M-` IDs they had when they lived in the core, so existing citations and `preflight` rule mappings still hold.

## M-3 — Services follow `interface → class → optional singleton`

Every service-shaped concept uses this exact shape:

```typescript
export interface TokenStore {
  get(): AccessToken | null;
  set(token: AccessToken | null): void;
}

export class MemoryTokenStore implements TokenStore {
  /* ... */
}

export const tokenStore: TokenStore = new MemoryTokenStore();
```

- Banned: `interface Foo` + `defaultFoo: Foo = { ... }` object-literal default. Banned: `interface Foo` + `createFoo()` factory returning a closure.
- Banned: loose top-level helper functions for service behavior.

Naming: interface is the abstract role with no `I`-prefix. Class name carries the implementation detail as a prefix (`MemoryTokenStore`, `BrowserNavigation`, `OslojsPkceGenerator`). Optional singleton is camelCase, typed as the interface. DI parameter types are interfaces, never concrete classes.

## M-4 — Don't over-engineer DI seams

A seam exists only when there's a real second implementation. If the only second implementation is the test fake, the seam is over-engineering. Examples of over-engineering (do NOT do): `Clock` interface for fake-timer injection (use `vi.useFakeTimers()`), `Navigation` injected as a function, splitting constructor parameters into Config + Deps.

The test: "Does anyone OTHER than the test suite ever want to swap this?" If no, no seam.

## M-5 — Constructor takes a single Zod-validated props object

Constructors that take both a config object AND a deps object are banned. Use one props object, validated by a Zod schema at the constructor boundary. Where the value benefits from runtime validation (env URLs, primitives), encode it as a Zod schema and parse at construction. Class instances flow through TS-typed. If a prop has a sensible default, use Zod's `.default()`.

## M-6 — Declarative parsing over procedural decoding

Multi-step procedural decoders (split → decode → check → decode → check → JSON.parse → check) are banned when Zod's `z.string().transform()` + `.preprocess()` + `.pipe()` can express the same flow declaratively.

## M-7 — TypeScript object keys are camelCase

Even when the wire format uses snake_case, TS objects use camelCase. Map at the boundary in the Zod schema's `.transform()`, not in consuming code.

## M-21 — Imports cross folders through package aliases

Across folders, import through a package subpath alias (`#persistence/...`, `#app/...`), never a `../` path. A relative import never leaves the package root.

## M-22 — TypeScript `private`, not `#private`

Encapsulation uses the `private` modifier. ECMAScript `#` members are banned.

## M-23 — A file is named for what it exports

An exported class ends with the PascalCase file name, implementation detail first as in M-3 (`logger-binder.ts` → `PinoLoggerBinder`). Files that deliberately hold a family of classes (`errors.ts`, `*-errors.ts`, `ids.ts`) are the exception.

## M-24 — Schema detail lives on the schema

Field-level context on a Zod schema goes in `.describe()` or `.meta()`, never in a comment beside the field, so it reaches every consumer the schema feeds, generated API docs included.

## M-25 — Environment is read once, through a schema

`process.env` is parsed once, by a Zod schema in the configuration module. Everything else receives typed config.

## Review tiers

**Tier A — objective**

| Mandate                                       | Enforceable by                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| M-3 interface → class → optional singleton    | eslint: `preflight/service-shape`, `preflight/no-loose-functions`             |
| M-5 single Zod-validated props object         | eslint: `preflight/constructor-single-props`                                  |
| M-7 camelCase TS object keys                  | _(no rule exists — always reviewed by reading)_                               |
| M-21 alias imports, nothing above the package | eslint: `preflight/no-parent-relative-imports`, `preflight/no-upward-imports` |
| M-22 TypeScript `private`                     | eslint: `preflight/no-ecmascript-private`                                     |
| M-23 file named for its export                | eslint: `preflight/filename-matches-export`                                   |
| M-24 schema detail on the schema              | eslint: `preflight/no-schema-field-comments`                                  |
| M-25 env read once                            | eslint: `preflight/no-env-outside-config`                                     |

**Tier B — judgment**

| Mandate                                 | The judgment it needs                             |
| --------------------------------------- | ------------------------------------------------- |
| M-4 don't over-engineer DI seams        | does anyone but the test suite want to swap this? |
| M-6 declarative over procedural parsing | could Zod express this flow?                      |
