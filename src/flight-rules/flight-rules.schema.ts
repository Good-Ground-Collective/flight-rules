import { z } from 'zod'

export const FlightRulesPropsSchema = z.object({
  cwd: z.string().optional().describe('Directory used for config discovery; defaults to process.cwd()'),
  env: z.record(z.string(), z.string().optional()).optional().describe('Live environment record; defaults to process.env'),
  configPath: z.string().optional().describe('Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery'),
})

export type FlightRulesProps = z.input<typeof FlightRulesPropsSchema>
