---
language: go
applies-to:
  - "**/*.go"
---

# Code Standards: Go

These mandates apply to Go files, in addition to the core charter. They are mandates, not preferences; violations are reviewable findings.

Go has a strong published style, and this charter builds on it rather than restating it. Where this charter is silent, the [Google Go Style Guide](https://google.github.io/styleguide/go/) governs: its [Guide](https://google.github.io/styleguide/go/guide) and [Decisions](https://google.github.io/styleguide/go/decisions) are normative, and its [Best Practices](https://google.github.io/styleguide/go/best-practices) are the default answer to any question they cover. [Effective Go](https://go.dev/doc/effective_go), [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) and [Go Test Comments](https://go.dev/wiki/TestComments) fill in what Google leaves out. Each mandate below links the section it rests on.

The mandates target the mistakes code written by habit from other languages makes in Go: producer-side interfaces, Java-style naming and layout, errors that are logged and returned, goroutines with no owner, and idioms from Go releases that are years old.

## How the core charter applies to Go

Go's language rules override some core mandates on `.go` files:

- **M-2.** A Go doc comment is a run of `//` lines directly above a declaration, starting with the declared name (G-11). Tool directives are `//go:` lines and `//nolint:<linter> // <reason>`.
- **M-11.** Go returns errors; it does not throw them. G-4 replaces M-11.
- **M-15.** A Go directory is a package, and a package is a namespace, so role folders (`models/`, `services/`, `repositories/`) produce exactly the package names G-2 bans. G-2 replaces M-15's module → role → concept shape for Go. The rest of M-15 holds: generic packages stay generic, and code lives beside its consumers.
- **M-16.** A file that outgrows its topic splits into more files in the same package, not into a subfolder, because a subfolder is a new package with a new API.
- **M-17.** Go tests are `_test.go` files in the directory of the code they test (G-10). There is no `__tests__/` folder.
- **M-20.** A suppression is `//nolint:<linter> // <reason>`, naming one linter and giving a reason.

## G-1 — Formatted, vetted and current with the toolchain

Every file is `gofmt`-formatted with imports grouped by `goimports`. `go vet` passes. `go fix ./...` has been run, so the code takes every rewrite the current release's modernizers offer.

Source: [Formatting](https://google.github.io/styleguide/go/guide#formatting).

## G-2 — Packages are named for what they provide

A package name is short, lowercase and one word, and it names the thing the package provides: `order`, `ledger`, `httpauth`. It is never a role or a grab-bag: `util`, `utils`, `common`, `helpers`, `models`, `types`, `services`, `interfaces` and `base` are banned.

Exported names don't repeat the package: `order.Service`, not `order.OrderService`; `ledger.New`, not `ledger.NewLedger` when `Ledger` is the package's main type.

A module follows [the Go module layout](https://go.dev/doc/modules/layout): binaries in `cmd/<name>/main.go`, code no other module should import under `internal/`, and domain packages below those. `pkg/` and `src/` directories, and the `golang-standards/project-layout` tree, are banned.

Source: [Package names](https://google.github.io/styleguide/go/decisions#package-names), [Util packages](https://google.github.io/styleguide/go/best-practices#util-packages), [Repetition](https://google.github.io/styleguide/go/decisions#repetition), [Package names (blog)](https://go.dev/blog/package-names).

## G-3 — Accept interfaces, return concrete types

Constructors and functions return concrete types (`*Store`, not `Storer`). An interface is declared in the package that consumes it, holds only the methods that consumer calls, and exists only when there is more than one real implementation or the consumer genuinely needs the seam. An interface declared next to its only implementation is banned. Core M-4's test applies: if nobody but the test suite swaps it, there is no interface.

Interface names describe behaviour (`Reader`, `Notifier`), with no `I` prefix and no `Interface` suffix.

Source: [Interfaces](https://google.github.io/styleguide/go/decisions#interfaces), [Avoid unnecessary interfaces](https://google.github.io/styleguide/go/best-practices#avoid-unnecessary-interfaces), [Interface ownership and visibility](https://google.github.io/styleguide/go/best-practices#interface-ownership-and-visibility).

## G-4 — Errors are values, handled once

- A function that can fail returns `error` as its last result. Every returned error is handled. Discarding one is a deliberate `_ =` on a call whose failure cannot matter (`_, _ = w.Write(b)` after the response has started), never a call left unassigned.
- Context is added by wrapping: `fmt.Errorf("load order %s: %w", id, err)`. Error strings are lowercase with no trailing punctuation.
- An error callers branch on is a package-level sentinel (`var ErrNotFound = errors.New("order not found")`) or a named type (`type ValidationError struct{...}`), and callers test it with `errors.Is` or `errors.As`, never `==`, a type switch on a wrapped error, or string matching.
- An error is handled once: logged **or** returned, never both.
- `panic` is for programmer errors and impossible states, and `Must` functions that run during initialization. Expected failures (bad input, missing rows, network errors) are returned.

Source: [Errors](https://google.github.io/styleguide/go/decisions#errors), [Handle errors](https://google.github.io/styleguide/go/decisions#handle-errors), [Error handling](https://google.github.io/styleguide/go/best-practices#error-handling), [Logging errors](https://google.github.io/styleguide/go/best-practices#logging-errors), [Don't panic](https://google.github.io/styleguide/go/decisions#dont-panic), [Working with errors in Go 1.13](https://go.dev/blog/go1.13-errors).

## G-5 — Context flows through every call that waits

A function that does I/O, blocks, or calls something that does takes `ctx context.Context` as its first parameter and passes it on. Where the signature is fixed by an interface the code implements, such as an `http.Handler`, the context comes from what the signature provides (`r.Context()`) and is passed on from there. A context is never stored in a struct. `context.Background()` and `context.TODO()` appear only in `main`, in tests, and at the entry point of a process-wide background task. Outbound HTTP requests are built with `http.NewRequestWithContext`.

Source: [Contexts](https://google.github.io/styleguide/go/decisions#contexts), [Custom contexts](https://google.github.io/styleguide/go/decisions#custom-contexts).

## G-6 — Every goroutine has an owner and an exit

The code that starts a goroutine owns both how it stops and the wait for it. Stopping is a signal the goroutine watches, usually a cancelled context. Waiting is `errgroup.Group.Wait`, `sync.WaitGroup.Wait` or a completion channel, and it happens before the owner returns or releases anything the goroutine uses; cancelling alone is not waiting. Fire-and-forget goroutines are banned.

APIs are synchronous; callers add concurrency when they need it. Shared state is guarded by a mutex. Channels hand off ownership or signal events, and are not used as a lock.

Source: [Goroutine lifetimes](https://google.github.io/styleguide/go/decisions#goroutine-lifetimes), [Synchronous functions](https://google.github.io/styleguide/go/decisions#synchronous-functions), [Go Code Review Comments: goroutine lifetimes](https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes).

## G-7 — Write the Go of the release in `go.mod`

The `go` directive names a supported Go release, and the code uses what that release offers. Old idioms are banned where a current one exists:

- `any`, not `interface{}`.
- `slices`, `maps`, `cmp`, `min` and `max`, not hand-written loops and helpers.
- `for i := range n`, not a three-clause counting loop.
- `errors.Join`, not a hand-rolled multi-error.
- `log/slog` with key-value attributes, not `log.Printf` or a third-party logger.
- `net/http` method and wildcard patterns (`mux.HandleFunc("GET /orders/{id}", ...)`), before reaching for a router library.
- `io` and `os`, never `io/ioutil`; `math/rand/v2`; standard-library `errors`, never `github.com/pkg/errors`.

Generics are for code that is genuinely type-independent, such as containers and algorithms over `cmp.Ordered`. They are never used to imitate inheritance or to avoid writing two small functions.

Source: [Use any](https://google.github.io/styleguide/go/decisions#use-any), [Generics](https://google.github.io/styleguide/go/decisions#generics), [Logging](https://google.github.io/styleguide/go/decisions#logging).

## G-8 — Go names

- MixedCaps, never underscores. Initialisms keep one case: `ID`, `URL`, `HTTP`, `userID`, `ServeHTTP`.
- Getters have no `Get` prefix: `Owner()`, not `GetOwner()`. Setters are `SetOwner()`.
- Receiver names are one or two letters, the same on every method of a type, and never `this` or `self`.
- Name length follows scope: `i` and `r` in a three-line loop, a descriptive name for a package-level value.

Core M-8 still applies: names say what a thing does, and vague names are banned.

Source: [Naming](https://google.github.io/styleguide/go/decisions#naming), [Initialisms](https://google.github.io/styleguide/go/decisions#initialisms), [Getters](https://google.github.io/styleguide/go/decisions#getters), [Receiver names](https://google.github.io/styleguide/go/decisions#receiver-names), [Variable names](https://google.github.io/styleguide/go/decisions#variable-names).

## G-9 — Handle the error, return, keep the happy path left

Errors and edge cases are handled first and return early. The success path is never nested inside an `else`, and there is no `else` after a block that returns. Named results are used only when they document something; a long function never has a bare `return`.

Source: [Indent error flow](https://google.github.io/styleguide/go/decisions#indent-error-flow), [Named result parameters](https://google.github.io/styleguide/go/decisions#named-result-parameters).

## G-10 — Tests use the standard `testing` package

Tests are `_test.go` files beside the code. They use `testing`, compare with `github.com/google/go-cmp/cmp` (`cmp.Diff`), and report failures as `got X, want Y` with the input that produced them. Assertion libraries are banned.

Several cases of one behaviour are a table-driven test with `t.Run` subtests. Test helpers call `t.Helper()`. Dependencies are real implementations, or small fakes written by hand in the test or a `<package>test` package. Mocking frameworks and generated mocks are banned. Core M-18 applies.

Source: [Assertion libraries](https://google.github.io/styleguide/go/decisions#assertion-libraries), [Useful test failures](https://google.github.io/styleguide/go/decisions#useful-test-failures), [Table-driven tests](https://google.github.io/styleguide/go/decisions#table-driven-tests), [Test doubles](https://google.github.io/styleguide/go/best-practices#naming-doubles), [Use real transports](https://google.github.io/styleguide/go/best-practices#use-real-transports).

## G-11 — Exported names carry doc comments

Every exported name has a doc comment that is a sentence beginning with that name (`// Store persists orders ...`). Every package has one package comment (`// Package order ...`), in exactly one file. Core M-2's no-dumb-comments bar applies to all of them, and no other comments are allowed.

Source: [Doc comments](https://google.github.io/styleguide/go/decisions#doc-comments), [Package comments](https://google.github.io/styleguide/go/decisions#package-comments), [Go Doc Comments](https://go.dev/doc/comment).

## G-12 — No hidden state

Dependencies are passed in explicitly, usually as fields of a struct built in `main`. `init()` functions and mutable package-level variables are banned. Package-level sentinel errors, compiled regular expressions and other values never written after initialization are allowed. Configuration and the environment are read once, in `main` or a config package, and passed down as typed values.

A type's zero value is useful where that can be arranged, and it needs no constructor then. Optional parameters are an options struct; variadic functional options are for public APIs with many rarely used options.

Source: [Global state](https://google.github.io/styleguide/go/best-practices#global-state), [Program initialization](https://google.github.io/styleguide/go/best-practices#program-initialization), [Option structure](https://google.github.io/styleguide/go/best-practices#option-structure).

## Review tiers

Rules named here are golangci-lint v2 linters, with staticcheck check IDs and revive rule names where a linter bundles many checks. The `preflight` package ships `go-no-go` and `recommended` golangci-lint configs that select them. Whether a rule enforces its mandate for a given file is what the review method's coverage step measures.

**Tier A — objective**

| Mandate                                   | Enforceable by                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| G-1 formatted and vetted                  | golangci-lint: formatters `gofmt`, `goimports`; linter `govet`                                                    |
| G-1 current with modernizers              | golangci-lint: `modernize`                                                                                        |
| G-2 no stutter                            | golangci-lint: revive `exported`                                                                                  |
| G-2 banned package names and layout       | _(no rule — always reviewed by reading)_                                                                          |
| G-3 return concrete types                 | golangci-lint: `ireturn`, `iface`                                                                                 |
| G-4 no unassigned error results           | golangci-lint: `errcheck`                                                                                         |
| G-4 wrapping, `errors.Is` and `errors.As` | golangci-lint: `errorlint`                                                                                        |
| G-4 sentinel and error type names         | golangci-lint: `errname`                                                                                          |
| G-4 error strings                         | golangci-lint: staticcheck `ST1005`                                                                               |
| G-4 handled once, `_ =` discards justified, no `panic` for failures | _(no rule — always reviewed by reading)_                                   |
| G-5 context passed, first, not stored     | golangci-lint: `noctx`, `contextcheck`, `containedctx`, revive `context-as-argument`                              |
| G-7 banned old packages                   | golangci-lint: `depguard`                                                                                         |
| G-7 current idioms                        | golangci-lint: `modernize`, `copyloopvar`, `usestdlibvars`, `sloglint`                                              |
| G-8 MixedCaps and initialisms             | golangci-lint: staticcheck `ST1003`                                                                               |
| G-8 receiver names                        | golangci-lint: revive `receiver-naming`, staticcheck `ST1016`                                                     |
| G-8 no `Get` prefix                       | _(no rule — always reviewed by reading)_                                                                          |
| G-9 early return, no `else` after return  | golangci-lint: revive `indent-error-flow`, `superfluous-else`, `early-return`; `nakedret`                         |
| G-10 no assertion or mocking libraries    | golangci-lint: `depguard`                                                                                         |
| G-10 helpers call `t.Helper()`            | golangci-lint: `thelper`                                                                                          |
| G-11 doc comments on exported names       | golangci-lint: revive `exported`, `package-comments`                                                              |
| G-12 no `init()`                          | golangci-lint: `gochecknoinits`                                                                                   |
| G-12 no mutable package state             | golangci-lint: `gochecknoglobals`                                                                                 |
| M-14 no commented-out code (Go files)     | golangci-lint: gocritic `commentedOutCode`                                                                        |
| M-20 suppressions carry a reason (Go)     | golangci-lint: `nolintlint` with `require-explanation` and `require-specific`                                     |

**Tier B — judgment**

| Mandate                              | The judgment it needs                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| G-2 package named for what it provides | would a caller know what `pkg.Name` does from the call site alone?    |
| G-3 interface earns its place        | is there a second real implementation, or a consumer that needs it?     |
| G-6 goroutine ownership              | can you point to the signal that stops this goroutine and the line that waits for it? |
| G-7 generics used for real           | is this code genuinely type-independent?                                |
| G-10 test shape                      | would a failure message alone tell you what broke and for which input? |
| G-12 options and zero values         | does this constructor or option exist only because another language would need it? |
