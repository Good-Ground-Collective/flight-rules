import { z } from "zod";
import { AgentRegistrationSchema } from "../agent-frontmatter/agent-frontmatter.schema.js";

export const ModelBindingsSchema = z.strictObject({
  standard: z.string().trim().min(1),
  escalated: z.string().trim().min(1),
  expert: z.string().trim().min(1),
});

export const AgentDefinitionSchema = z.strictObject({
  frontmatter: AgentRegistrationSchema,
  body: z.string().refine((body) => body.trim() !== "", "agent prompt must not be empty"),
});
