import { z } from "zod";
import { SemanticTypeSchema } from "../semantic-types.js";


export const CommitMessageInputSchema = z.object({
    type: SemanticTypeSchema,
    // Bare issue numbers make one-character scopes legitimate; 32 clears a 10-character tracker key plus a six-digit number.
    scope: z.string().min(1).max(32),
    description: z.string().min(2).max(50),
    body: z.string().optional(),
    model: z.string().max(72).optional(),
    footers: z.array(z.string().regex(/^[a-zA-Z0-9-]+(: |=).*$/)).default([])
})

export const CommitMessageHeaderSchema = z.preprocess((arg: unknown) => {
        return z.string({ error: "Git Commit headers should be 72 characters or less"}).max(72).parse(arg);
    },
    z.templateLiteral([SemanticTypeSchema, '(', z.string(), '): ', z.string()]))

export const CommitMessageBuilderPropsSchema = z.object({
    binPath: z.string().min(1),
    agentEnv: z.string().optional()
})

export type CommitMessageInput= z.infer<typeof CommitMessageInputSchema>

export type CommitMessageBuilderProps = z.infer<typeof CommitMessageBuilderPropsSchema>

