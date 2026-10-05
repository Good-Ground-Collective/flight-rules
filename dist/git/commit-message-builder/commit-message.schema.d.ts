import { z } from "zod";
export declare const CommitMessageInputSchema: z.ZodObject<{
    type: z.ZodEnum<{
        docs: "docs";
        feat: "feat";
        fix: "fix";
        perf: "perf";
        refactor: "refactor";
        test: "test";
        build: "build";
        ci: "ci";
        chore: "chore";
        style: "style";
        revert: "revert";
    }>;
    scope: z.ZodString;
    description: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    footers: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const CommitMessageHeaderSchema: z.ZodPreprocess<z.ZodTemplateLiteral<`docs(${string}): ${string}` | `feat(${string}): ${string}` | `fix(${string}): ${string}` | `perf(${string}): ${string}` | `refactor(${string}): ${string}` | `test(${string}): ${string}` | `build(${string}): ${string}` | `ci(${string}): ${string}` | `chore(${string}): ${string}` | `style(${string}): ${string}` | `revert(${string}): ${string}`>, unknown>;
export declare const CommitMessageBuilderPropsSchema: z.ZodObject<{
    binPath: z.ZodString;
    agentEnv: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CommitMessageInput = z.infer<typeof CommitMessageInputSchema>;
export type CommitMessageBuilderProps = z.infer<typeof CommitMessageBuilderPropsSchema>;
