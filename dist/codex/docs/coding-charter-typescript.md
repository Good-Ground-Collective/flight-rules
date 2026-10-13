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

export class MemoryTokenStore implements TokenStore { /* ... */ }

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

## Review tiers

**Tier A — objective**

| Mandate                                    | Enforceable by                                                |
| ------------------------------------------ | ------------------------------------------------------------- |
| M-3 interface → class → optional singleton | eslint: `preflight/service-shape`, `preflight/no-loose-functions` |
| M-5 single Zod-validated props object      | eslint: `preflight/constructor-single-props`                  |
| M-7 camelCase TS object keys               | _(no rule exists — always reviewed by reading)_               |

**Tier B — judgment**

| Mandate                                 | The judgment it needs                             |
| --------------------------------------- | ------------------------------------------------- |
| M-4 don't over-engineer DI seams        | does anyone but the test suite want to swap this? |
| M-6 declarative over procedural parsing | could Zod express this flow?                      |
