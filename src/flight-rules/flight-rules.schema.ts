import { z } from 'zod'
import { NativeHostSchema } from '../plugins/native-installation/native-installation.js'
import type { HostSettingsSource } from '../shared/host-settings/host-settings-source.js'

export const FlightRulesPropsSchema = z.object({
  cwd: z.string().optional().describe('Directory used for config discovery; defaults to process.cwd()'),
  env: z.record(z.string(), z.string().optional()).optional().describe('Live environment record; defaults to process.env'),
  configPath: z.string().optional().describe('Explicit config file, taking precedence over FLIGHT_RULES_CONFIG and discovery'),
  host: NativeHostSchema.optional().describe('Explicit configuration host; otherwise FLIGHT_RULES_HOST, the native package host, or Claude for compatibility'),
})

export type FlightRulesProps = z.input<typeof FlightRulesPropsSchema> & {
  /** The host's settings layers (a host adapter's seam); defaults to Claude Code's. */
  hostSettings?: HostSettingsSource
}
