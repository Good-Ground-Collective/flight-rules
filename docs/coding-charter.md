# Code Standards

These are mandates, not preferences. Violations are reviewable findings.

This is the language-agnostic core charter. It applies to every file, together with each language charter whose `applies-to` paths match the files in play: `flight-rules charter` always loads both. Where a language charter is more specific than the core, it governs that language's files. Mandate IDs are stable; the gaps in this charter's numbering are mandates that moved to the TypeScript charter.

## M-1 — No planning-system identifiers in source code

Banned tokens in production source: `Phase N`, `D-NN` decision codes, `T-X-NN` threat codes, REQ-IDs (`SERV-NN`, `ERR-NN`, `PAGE-NN`, etc.), `Pitfall N`, `RESEARCH §Q*`, `CONTEXT.md`, `PLAN.md`, `CR-NN`, `WR-NN`, `IN-NN`, "from a previous phase", "the next phase will".

**Why:** code outlives planning systems. Six months from now no one knows what "T-4-05" or "D-09" means.

**Where it belongs instead:** architectural rationale in the doc comment on the relevant declaration (JSDoc, ApexDoc, docstrings) *in application terms* ("Same-origin returnTo guards against open-redirect through the OAuth callback" — NOT "T-4-05 open-redirect defense"). Threat-model IDs, decision codes, and phase references stay in planning artifacts, never source.

## M-2 — Doc comments on declarations; no other comments

The only comments allowed in source are doc comments (`/** ... */` in TypeScript, Apex and Java) directly above a declaration, and tool directives: lint and compiler suppressions, coverage and formatter pragmas, and annotations another lint rule requires. Explanatory line comments, block comments and why-this-line notes are banned. If a line needs explaining, rename it, extract it into a named method, or put the explanation in the doc comment of the declaration it belongs to.

No dumb comments. If a reader who knows the language and the codebase can derive the comment from the code, the comment is noise. **This applies inside doc comments too.** A doc comment on a declaration is allowed and often required for non-obvious framing, but its body still has to clear the no-dumb-comments bar. "Callers should pass a fresh snapshot" on a pure function that takes `state: AuthState` as a parameter is a dumb comment.

## M-8 — Names say what a thing does

Methods are named for what an English-speaking developer would call them. Bizarre verbs are banned (`installSession` for setting a session is banned; `applySession` or `setActiveSession` is preferred). Test: would a new hire understand this method name without context?

A service, class or folder name is a noun for its role (`DeviceRegistry`, `OutboxReplay`), never a name that reads like the data it touches (`DeviceTokens`). Vague names (`platform`, `utils`, `helpers`) are banned.

## M-9 — Visual grouping with newlines

Methods longer than ~10 lines are visually grouped by purpose, with blank lines separating logical phases. Reading code is a human activity; visual rhythm matters.

## M-10 — Flat if-else over nested switch+if

A `switch` containing nested `if` statements inside each case is a smell. Flatten it.

## M-11 — Throw typed errors at the call site

Sentinel/throw-helper functions whose entire job is to throw are banned. Define a named error class and throw it inline at the call site.

## M-12 — READMEs document concepts, never linter rules

READMEs describe architecture, intent, and how features fit into the app. They never restate rules a linter enforces — the linter does that work.

## M-13 The Code Models Reality, Not The Other Way Around

When building a system, we are attempting to codfy the messy world into a set of rules and procedures. The system services the domain, not the other way around. A phrase like "Well, we do it this way because the {SOFTWARE_NAME} requires it" implies that the software owns the work rather than enabling it. 

In some scenarios, we may use our software to drive a specific workflow pattern that the user isn't used to. This doesn't violate that rule above. In that scenario, the software is a mechanism for representing our opinion on how the domain should function. 

This should extend into every corner of the system. Even technical subsystems should express their purpose from a product lense, as oppsoed to a technical one. Every piece of our stack is meant to serve our users, and our domain.

An example of how to reframe something as technically bland as an S3 Adaptor (the example is TypeScript; the principle is not):

**Bad**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { lookup as lookupMime } from "mime-types";

export class S3UploadError extends Error {
    constructor(public readonly filePath: string, options?: { cause?: unknown }) {
        super(`Failed to upload to S3: ${filePath}`, options);
        this.name = "S3UploadError";
    }
}

export class S3DownloadError extends Error {
    constructor(public readonly filePath: string, options?: { cause?: unknown }) {
        super(`Failed to download from S3: ${filePath}`, options);
        this.name = "S3DownloadError";
    }
}

export class S3NotFoundError extends Error {
    constructor(public readonly filePath: string) {
        super(`S3 object not found: ${filePath}`);
        this.name = "S3NotFoundError";
    }
}

const splitPath = (filePath: string): { Bucket: string; Key: string } => {
    const trimmed = filePath.replace(/^\/+/, "");
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) {
        throw new Error(`Invalid S3 path "${filePath}" — expected "<bucket>/<key>"`);
    }
    return { Bucket: trimmed.slice(0, slash), Key: trimmed.slice(slash + 1) };
};

export const s3UploadHandler = async (
    awsCLient: S3Client,
    filePath: string,
    file: unknown,
    ): Promise<void> => {
    const { Bucket, Key } = splitPath(filePath);
    const ContentType = lookupMime(Key) || "application/octet-stream";

    try {
    await awsCLient.send(
        new PutObjectCommand({
            Bucket,
            Key,
            Body: file as PutObjectCommand["input"]["Body"],
            ContentType,
        }),
    );
    } catch (cause) {
    throw new S3UploadError(filePath, { cause });
    }
};
```

**Good:**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { lookup as lookupMime } from "mime-types";
import z from "zod"
import { ok, failure, type PromisedResult } from "./results";
import { S3PathPartsValidator } from "@file-upload/schemas"


const FileProviderPropsSchema = z.object({
    s3Client: z.instanceOf(S3Client).optional()
})

export type FileProviderProps = z.infer<typeof FileProviderPropsSchema>
export type FileProviderTerminalState = 'UPLOADED' | 'DOWNLOADED' | 'FAILED';

export class FileProvider {
    private s3Client: S3Client;

    constructor(props: FileProviderProps) {
        const validProps = FileProviderPropsSchema.parse(props);
        this.s3Client = validProps.s3Client ?? new S3Client({});
    }

    public async upload<T>(filePath: string, content: T): PromisedResult<FileProviderTerminalState> {
        const validatedPathResult = S3PathPartsValidator.safeParse(filePath);
        if (!validatedPathResult.success) {
            return failure(new InvalidFilePathError(validatePathResult.errors.join(', '), filePath));
        }

        const { bucket, path } = validatedPathResult.data;
        const contentType = lookupMime(Key) || "application/octet-stream";

        try {
            await this.s3CLient.send(
                new PutObjectCommand({
                    Bucket,
                    Key,
                    Body: file,
                    ContentType,
                }),
            );
        } catch (err) {
            return failure(new UploadFileError('Failed to upload file', filePath, err));
        }

        return ok<FileProviderTerminalState>('UPLOADED');
    }
}


export class FileProviderError extends Error {
    override name: string = 'FileProviderError';
}

export class InvalidFilePathError extends FileProviderError {
    override name: string = 'InvalidFilePathError';
    public invalidPathName: string;

    constructor(message: string, filePath: string) {
        super(message);
        this.invalidPathName = filePath;
    }
}

export class UploadFailureError extends FileProviderError {
    override name: string = 'UploadFailureError';
    public invalidPathName: string;

    constructor(message: string, filePath: string, cause: error) {
        super(message, { cause: error });
        this.invalidPathName = filePath;
    }
}

```

## M-14 — No commented-out code

Dead code is never committed; version control is the history. Delete it.

## M-15 — Layout follows the domain: module, then role, then concept

Code is grouped by module first. Inside a module, a role folder says what kind of thing a file is (models, services, definitions, repositories, …), and a concept folder inside the role holds one concept's files. Submodules repeat the same shape. A file's path tells a reader what it is and which domain owns it.

- Hierarchies are wide and nested. A folder that keeps growing is split by subdomain, not left as a flat list.
- Only the folders and files the project declares sit at the source root. Everything else lives in a module.
- A generic or platform module holds only mechanism. A domain's definitions, schemas and vendor wiring live in the subdomain that owns them, never in a central folder every domain writes into. Platform modules import nothing from the domains that use them.
- Files live beside their consumers. Something only one feature needs is not a project-wide file.

## M-16 — Small, single-topic files

A file covers one topic. When a file grows past its topic, it becomes a folder named after it, with the interface, its props and types, and each implementation in separate files. Errors, schemas and types each get a file of their own rather than piling up at the top of a service.

## M-17 — Tests are colocated, and named for what they test

A test lives in a `__tests__/` folder directly beside the code it covers. A unit test is named for its source file (`schedule-builder.ts` → `__tests__/schedule-builder.test.ts`). Integration and cross-concept tests go in the parent module's `__tests__/`. There is no repository-level test tree and no top-level `__tests__/` folder.

## M-18 — Tests prove behaviour, not tooling

A test that only re-proves what a linter, the type checker or a schema library already guarantees is noise. Delete it and rely on the tool.

## M-19 — Only shipped artifacts are committed

Plans, agent scratch files, one-off backfill scripts and spec directories stay out of the repository. Rationale that matters goes in the PR body, an RFC, or a doc comment phrased in application terms (see M-1).

## M-20 — Fix the finding, don't suppress it

A lint suppression is a last resort: it names the rule, carries a reason, and is removed once the root cause can be fixed. A whole area of code living behind a suppression means the rule or the design is wrong. Fix one of them.

## Review tiers

Autonomous review checks Tier A mandates on every instance and raises each Tier B mandate at most once, with representative examples. A rule named here _can_ enforce a mandate; whether it does for a given file is what the review method's coverage step measures. Core mandates apply to every changed file, so a file whose linter has no rule for a mandate is always reviewed by reading.

**Tier A — objective**

| Mandate                                     | Enforceable by                                                      |
| ------------------------------------------- | ------------------------------------------------------------------- |
| M-1 no planning-system identifiers          | eslint: `preflight/no-planning-identifiers`                         |
| M-2 structural: only doc comments and directives | eslint: `preflight/no-comments`, `preflight/no-paragraph-comments` |
| M-10 flat if-else over nested switch+if     | eslint: `preflight/no-switch-with-nested-if`                        |
| M-11 typed errors thrown at the call site   | eslint: `preflight/no-throw-helpers`, `preflight/error-class-sets-name` |
| M-14 no commented-out code | eslint: `preflight/no-comments` |
| M-15 module → role → concept layout | eslint: `preflight/module-layout` |
| M-16 small, single-topic files (size) | eslint: `max-lines`, `preflight/max-directory-entries` |
| M-17 colocated, named tests | eslint: `preflight/test-location`, `preflight/test-file-naming` |
| M-20 suppressions carry a reason | eslint: `eslint-comments/require-description` |

**Tier B — judgment**

| Mandate                               | The judgment it needs                         |
| ------------------------------------- | --------------------------------------------- |
| M-2 quality: the no-dumb-comments bar | is this comment derivable from the code?      |
| M-8 names say what a thing does       | would a new hire understand the name cold?    |
| M-9 visual grouping with newlines     | does this read with any rhythm?               |
| M-12 READMEs document concepts        | is this restating a linter rule?              |
| M-13 the code models reality          | is this framed in domain terms or tool terms? |
| M-15 generic modules stay generic | does this file name a domain or vendor concept? |
| M-16 single topic | could this file split along a seam a reader would recognize? |
| M-18 tests prove behaviour | would this test still matter with the linter and schema removed? |
| M-19 only shipped artifacts | will anyone run or read this after the PR merges? |

M-2 straddles both tiers on purpose. The structural ban — paragraph blocks above non-declarations — is mechanical and belongs in Tier A. "No dumb comments" is a judgment call about a specific comment's value.
