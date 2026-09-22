import { z } from "zod";

export const agentCapabilities = ["read", "edit", "shell", "web", "spawn", "ask"] as const;
export const modelTiers = ["standard", "escalated", "expert"] as const;
export const reasoningLevels = ["low", "medium", "high"] as const;
export const claudeAgentColors = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"] as const;

export const AgentCapabilitySchema = z.enum(agentCapabilities);
export const ModelTierSchema = z.enum(modelTiers);

/** Host-neutral capabilities and execution preferences shared by agent adapters. */
export const AgentFrontmatterSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  capabilities: z.array(AgentCapabilitySchema).min(1).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    { message: "duplicate capability" },
  ),
  model: ModelTierSchema,
  reasoning: z.enum(reasoningLevels).optional(),
  sandbox: z.strictObject({
    fs: z.enum(["read-only", "workspace-write"]),
    network: z.enum(["none", "enabled"]),
  }).optional(),
  dispatch: z.strictObject({
    maxConcurrent: z.int().positive(),
    maxDepth: z.int().positive(),
  }).optional(),
  "x-claude": z.strictObject({ color: z.enum(claudeAgentColors).optional() }).optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
