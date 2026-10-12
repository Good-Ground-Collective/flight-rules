---
language: apex
applies-to:
  - "**/*.cls"
  - "**/*.trigger"
---

# Code Standards: Apex

These mandates apply to Apex classes and triggers, in addition to the core charter. They are mandates, not preferences; violations are reviewable findings. A repository's CODE-REVIEW.md or AGENTS.md names the frameworks its code is built on — its dependency-injection registry, unit of work, REST router, logger, API version and test-naming prefix — and those bindings refine the mandates here.

**Applicability.** The architecture mandates (A-6 to A-10) are mandatory for new and significantly changed code. A small edit inside legacy code may stay consistent with its surroundings; the legacy is refactored deliberately, not treated as precedent. Every other mandate applies to every change.

## A-1 — Names carry role and casing

Classes are `PascalCase` with a suffix naming their role (`Controller`, `Service`, `Repository`, `Validator`, `Mapper`, `TriggerHandler`). Methods and variables are `camelCase` and action-oriented; constants are `SCREAMING_SNAKE_CASE`. Only `HTTP`, `URL` and `ID` are accepted abbreviations.

- **Banned:** `Utils`, `Helper` and other catch-all classes; truncated names like `IncidentCtrl`; single-letter variables (`t`, `p`).
- **Preferred:** `IncidentService`, `getRecentIncidents()`, `MAX_RETRY_ATTEMPTS`.

**Why:** a catch-all class becomes a god class, and a name without its role hides which layer the code belongs to.

## A-2 — ApexDoc on every public API

Public and global classes carry a purpose comment; their public methods document `@param`, `@return` and `@throws`. This is the Apex form of the core charter's doc-comment mandate, and ApexDoc is preferred over large in-repo design documents.

## A-3 — Never SOQL or DML in a loop

Collect IDs into a `Set`, query once with `IN :ids`, and run DML on the whole collection. Bulkify by default: every trigger and service method assumes it receives 200 records.

**Why:** governor limits are per transaction, and a loop that is fine for one record fails for a data load.

## A-4 — Explicit field lists in SOQL

Select exactly the fields the code uses. No `FIELDS(ALL)`, `FIELDS(STANDARD)` or `FIELDS(CUSTOM)` in production code.

## A-5 — Declare a sharing keyword on every class that touches the database

Every class containing SOQL or DML declares one, and `with sharing` is the default. `without sharing` and `inherited sharing` are used deliberately and, when they escalate privilege, documented. Classes with no database access — value objects, DTOs, builders, error types — declare `inherited sharing`: it says the class takes no position and runs in its caller's, which stays true if a query is added later. Interfaces and enums are exempt; the platform disallows the keyword on them. Never expose elevated privilege to user input.

- **Banned:** `public class IncidentController { }` on a class that queries.
- **Preferred:** `public with sharing class IncidentController { }`; `public inherited sharing class PersonAttributes { }` for a class with no database access.

**`AccessLevel.SYSTEM_MODE` does not bypass sharing — it delegates it to this keyword.** `USER_MODE` enforces object permissions, field-level security and sharing unconditionally. `SYSTEM_MODE` ignores object permissions and field-level security but leaves record sharing to the class's sharing keyword. A repository that writes in `SYSTEM_MODE` while declared `inherited sharing` performs record-level checks only if its caller happens to be `with sharing` — and if that repository is `@NamespaceAccessible` or `global`, the caller may be a package you do not control. Repositories that write in `SYSTEM_MODE` declare `with sharing` explicitly.

## A-6 — Thin exposures; logic in services and the domain

Controllers, REST resources and invocable methods validate input and check permissions at the entry point, then delegate. Calculations and state changes live in the service or domain layer, never in the exposure. REST endpoints go through the repository's routing framework when it has one.

## A-7 — Database access behind a repository

Services never inline `[SELECT …]` or DML; they call a repository (`IncidentRepository.getById(...)`). Each repository owns the queries and writes for its object or aggregate, behind the repository interface the codebase defines.

**Why:** one place to optimize queries and enforce security, and a seam that lets services be tested without the database.

## A-8 — Rich domain models, not anemic DTOs

Put behaviour on the model (`incident.isOverdue()`, `incident.calculateRisk()`) instead of scattering `if (incident.Status == 'New')` across services.

## A-9 — Explicit, compile-time-safe transformers between layers

Convert at boundaries with a typed transformer (`IncidentTransformer.toDto(record)`): exposures to DTOs, repositories to domain models. String-keyed or metadata-driven mapping is for schema-flexible integration edges only.

**Why:** the compiler catches mapping errors, and "find usages" works.

## A-10 — Depend on interfaces; commit DML once

Define an interface for any collaborator whose implementation varies by environment or must be replaced in tests, and resolve it through the codebase's dependency-injection mechanism rather than constructing the implementation inline. Register record changes with the codebase's unit of work and commit once, rather than scattering `insert`, `update` and `delete`.

**Why:** Apex has no module mocking, so an interface plus DI is the only way to test a service without its real dependencies; a unit of work gives bulkification and all-or-nothing transactions for free.

## A-11 — Catch specific exceptions; wrap, log and rethrow; never swallow

Never catch bare `Exception` and never leave a `catch` block empty. Wrap low-level failures in domain exceptions (`RepositoryException`, `ValidationException`) with context, log the original through the codebase's logger before rethrowing, and clean up in `finally`.

```apex
try {
    upsert incidents;
} catch (DmlException e) {
    throw new RepositoryException('Unable to save incidents', e);
}
```

## A-12 — `Assert` with a message on every assertion

Use the `Assert` class (`Assert.areEqual`, `Assert.isNotNull`, `Assert.isTrue`) with a message saying what should be true. The legacy `System.assert*` methods are banned in new tests.

- **Banned:** `System.assertEquals('New', incident.Status__c);`
- **Preferred:** `Assert.areEqual('New', incident.Status__c, 'A new incident starts in New status');`

## A-13 — Tests are independent and cover both paths

Test classes are `<ClassName>Test`, and test method names describe the behaviour under test (the repository sets the prefix convention). Arrange, act, assert: wrap the action in `Test.startTest()` / `Test.stopTest()`, share fixtures through `@TestSetup`, keep tests independent of each other and of org data, and cover the failure path as well as the success path.

## A-14 — Braces always; formatting belongs to the formatter

Every `if`, `else`, `for` and `while` body is in braces, even a single statement. Indentation, line width and wrapping are whatever the repository's Prettier configuration produces: if the formatter passes, formatting passes, and indent characters or line width are never review findings.

- **Banned:** `if (status == 'Closed') sendNotification();`

## A-15 — Short methods, null-safe collections, no magic values

Methods stay under roughly 50 lines. Guard nulls with `String.isBlank()` and explicit checks, initialize collections at declaration, prefer immutable data, and name literals as constants.

## A-16 — No logic in triggers

A trigger body only delegates to a handler (`new IncidentTriggerHandler().afterInsert(Trigger.new)`). Business logic never lives in the trigger.

## A-17 — No hard-coded IDs or environment values

Never hard-code record IDs, record type IDs, user IDs, URLs or other environment values. Look them up, or read them from custom metadata, custom settings or constants derived from them.

**Why:** IDs differ between orgs, so hard-coded ones pass in one sandbox and fail everywhere else.

## Review tiers

Rules named here are PMD rules run through Salesforce Code Analyzer. Whether a rule enforces its mandate for a given file is what the review method's coverage step measures.

**Tier A — objective**

| Mandate                                      | Enforceable by                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A-1 casing                                   | PMD: `ClassNamingConventions`, `MethodNamingConventions`, `FieldNamingConventions`, `LocalVariableNamingConventions` |
| A-1 role suffixes and banned names           | _(no rule — always reviewed by reading)_                                                                      |
| A-2 ApexDoc on public API                    | PMD: `ApexDoc`                                                                                                |
| A-3 no SOQL or DML in a loop                 | PMD: `OperationWithLimitsInLoop`                                                                              |
| A-4 explicit field lists                     | _(no rule — always reviewed by reading)_                                                                      |
| A-5 sharing keyword on database classes      | PMD: `ApexSharingViolations`                                                                                  |
| A-11 no bare `Exception`, no empty `catch`   | PMD: `EmptyCatchBlock` (empty blocks only; bare `Exception` is reviewed)                                       |
| A-12 `Assert` with a message                 | PMD: `ApexAssertionsShouldIncludeMessage` (`System.assert*` use is reviewed)                                  |
| A-14 braces always                           | PMD: `IfStmtsMustUseBraces`, `IfElseStmtsMustUseBraces`, `ForLoopsMustUseBraces`, `WhileLoopsMustUseBraces`   |
| A-16 no logic in triggers                    | PMD: `AvoidLogicInTrigger`                                                                                    |
| A-17 no hard-coded IDs                       | PMD: `AvoidHardcodingId` (IDs only; other environment values are reviewed)                                    |

**Tier B — judgment**

| Mandate                                   | The judgment it needs                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| A-6 thin exposures                        | is the entry point deciding anything a service should?                 |
| A-7 database access behind a repository   | does a service or exposure query or write directly?                    |
| A-8 rich domain models                    | is behaviour about a record scattered across services?                 |
| A-9 typed transformers                    | is a boundary mapped with strings where types would catch mistakes?    |
| A-10 interfaces and one commit            | can this be tested without the database, and does DML commit once?     |
| A-13 independent tests on both paths      | would this test fail if the behaviour broke, including the error path? |
| A-15 short methods, null safety, no magic | does this method do one thing, and could a null or literal surprise?   |
