# Code Standards

These are mandates, not preferences. Violations are reviewable findings.

This is the language-agnostic core charter. It applies to every file, together with each language charter whose `applies-to` paths match the files in play: `flight-rules charter` always loads both. Where a language charter is more specific than the core, it governs that language's files. Mandate IDs are stable; the gaps in this charter's numbering are mandates that moved to the TypeScript charter.

## M-1 — No planning-system identifiers in source code

Banned tokens in production source: `Phase N`, `D-NN` decision codes, `T-X-NN` threat codes, REQ-IDs (`SERV-NN`, `ERR-NN`, `PAGE-NN`, etc.), `Pitfall N`, `RESEARCH §Q*`, `CONTEXT.md`, `PLAN.md`, `CR-NN`, `WR-NN`, `IN-NN`, "from a previous phase", "the next phase will".

**Why:** code outlives planning systems. Six months from now no one knows what "T-4-05" or "D-09" means.

**Where it belongs instead:** architectural rationale in the doc comment on the relevant declaration (JSDoc, ApexDoc, docstrings) *in application terms* ("Same-origin returnTo guards against open-redirect through the OAuth callback" — NOT "T-4-05 open-redirect defense"). Threat-model IDs, decision codes, and phase references stay in planning artifacts, never source.

## M-2 — Doc comments on declarations, not paragraph block comments

- Banned: multi-line `// ...` paragraph comments at file top. 
- Banned: paragraph block comments above non-declaration code.

Required: file-level concepts as a doc comment on the primary exported declaration; class/method concepts as a doc comment (`/** ... */` in TypeScript, Apex and Java) directly above the declaration. Why-this-line comments are at most one short line, only when the *why* is non-obvious.

No dumb comments. If a reader who knows the language and the codebase can derive the comment from the code, the comment is noise. **This applies inside doc comments too.** A doc comment on a declaration is allowed and often required for non-obvious framing, but its body still has to clear the no-dumb-comments bar. "Callers should pass a fresh snapshot" on a pure function that takes `state: AuthState` as a parameter is a dumb comment regardless of whether it lives in `// ...` or `/** ... */`.

## M-8 — Method names use ordinary English

Methods are named for what an English-speaking developer would call them. Bizarre verbs are banned (`installSession` for setting a session is banned; `applySession` or `setActiveSession` is preferred). Test: would a new hire understand this method name without context?

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
import { ok, failure, type PromisedResult } from "@think-lp/cloud-sdk/results";
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