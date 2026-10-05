import { z } from "zod";
export declare const semanticTypes: readonly ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "style", "revert"];
export declare const SemanticTypeSchema: z.ZodEnum<{
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
export type SemanticType = z.infer<typeof SemanticTypeSchema>;
