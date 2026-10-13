import { readFileSync } from 'node:fs'
import { Command, Option } from 'commander'
import type { Config } from '../../../shared/config.js'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import type { ToolProbe } from '../../tool-probe/tool-probe.js'
import { QaInstructionsFinder } from '../../qa-instructions/qa-instructions.js'
import { NodeRepositoryReadiness, type RepositoryReadiness } from '../../readiness/repository-readiness.js'
import { ReadinessOptionsSchema, WorkflowSchema } from '../../readiness/readiness.schema.js'

export class ReadinessFailedError extends Error {
  override name = 'ReadinessFailedError'
}

export function createCheckCommand(
  getConfig: () => Config,
  getTracker: () => TaskTracker,
  getConfigPath: () => string,
  getProbe: () => ToolProbe,
  getFinder: () => QaInstructionsFinder = () => new QaInstructionsFinder(),
  getReadiness: () => RepositoryReadiness = () => new NodeRepositoryReadiness(),
): Command {
  const check = new Command('check')
  check.addOption(new Option('--workflow <name>', 'check readiness for this workflow before its first mutation').choices(WorkflowSchema.options))
    .option('--runtime-file <path>', 'JSON containing current caller/worker capability observations; requires --workflow')
    .exitOverride().action(async (options: { workflow?: string; runtimeFile?: string }) => {
      let evidence: unknown
      try {
        evidence = options.runtimeFile === undefined ? undefined : JSON.parse(readFileSync(options.runtimeFile, 'utf8'))
      } catch {
        process.stdout.write(JSON.stringify({ tracker: null, repo: null, checks: [{ name: 'runtime', ok: false, required: true, code: 'INVALID_CONTEXT', detail: 'Cannot read a JSON runtime evidence file', remedy: 'Supply a readable evidence file; see flight-rules doc workflow-preflight.' }], ok: false, scope: 'workflow' }) + '\n')
        throw new ReadinessFailedError('flight-rules check failed — see report above')
      }
      const parsed = ReadinessOptionsSchema.safeParse({ workflow: options.workflow, evidence })
      if (!parsed.success) {
        process.stdout.write(JSON.stringify({ tracker: null, repo: null, checks: [{ name: 'runtime', ok: false, required: true, code: 'INVALID_CONTEXT', detail: 'Invalid workflow runtime evidence', remedy: 'Supply evidence matching WorkflowEvidenceSchema with a --workflow selection.' }], ok: false, scope: 'workflow' }) + '\n')
        throw new ReadinessFailedError('flight-rules check failed — see report above')
      }
      const report = await getReadiness().inspect({ config: getConfig, tracker: getTracker, configPath: getConfigPath, probe: getProbe(), finder: getFinder(),
        options: parsed.data })
      process.stdout.write(JSON.stringify(report) + '\n')
      if (!report.ok) throw new ReadinessFailedError('flight-rules check failed — see report above')
    })
  return check
}
