import { z } from "zod";

export const OperationEffectSchema = z.enum(["read", "write", "network", "process"]);
export const OperationIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const CliRouteSchema = z.object({
  path: z.array(z.string().min(1)).min(1),
  aliases: z.array(z.string().min(1)).default([]),
});

export const OperationErrorSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
});

export const OperationEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.unknown() }),
  z.object({ status: z.literal("error"), error: OperationErrorSchema }),
  z.object({ status: z.literal("partial"), data: z.unknown(), error: OperationErrorSchema }),
]);

export type OperationEffect = z.infer<typeof OperationEffectSchema>;
export type OperationEnvelope = z.infer<typeof OperationEnvelopeSchema>;
export type CliRoute = z.infer<typeof CliRouteSchema>;
