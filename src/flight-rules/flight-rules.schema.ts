import { z } from 'zod'
import type { HostSettingsSource } from '../shared/host-settings/host-settings-source.js'

export const FlightRulesPropsSchema = z.object({
  cwd: z.string().optional().describe('Directory used for config discovery; defaults to process.cwd()'),
  env: z.record(z.string(), z.string().optional()).optional().describe('Live environment record; defaults to process.env'),
  configPath: z.string().optional().describe('Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery'),
})

export type FlightRulesProps = z.input<typeof FlightRulesPropsSchema> & {
  /** The host's settings layers (a host adapter's seam); defaults to Claude Code's. */
  hostSettings?: HostSettingsSource
}
