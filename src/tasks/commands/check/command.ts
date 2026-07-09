import { Command } from 'commander'
import type { Config } from '../../../config.js'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

type Check = { name: string; ok: boolean; detail: string }

// Required credential env var per tracker, so the check stays deterministic and
// the tracker specifics live here in the CLI rather than in any skill.
const credentialVar: Record<Config['tracker'], string | undefined> = {
  github: 'GITHUB_TOKEN',
  jira: undefined,
}

export function createCheckCommand(
  getConfig: () => Config,
  getTracker: () => TaskTracker,
): Command {
  const check = new Command('check')

  check.exitOverride().action(async () => {
    const checks: Check[] = []

    let config: Config
    try {
      config = getConfig()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      checks.push({ name: 'config', ok: false, detail })
      process.stdout.write(JSON.stringify({ tracker: null, repo: null, checks, ok: false }) + '\n')
      throw new Error('flight-rules check failed — config could not be resolved')
    }
    checks.push({ name: 'config', ok: true, detail: `tracker=${config.tracker} repo=${config.repo}` })

    const credVar = credentialVar[config.tracker]
    const credOk = credVar === undefined || process.env[credVar] !== undefined
    checks.push({
      name: 'credentials',
      ok: credOk,
      detail: credOk ? 'present' : `${credVar} is not set`,
    })

    if (credOk) {
      try {
        await getTracker().ping()
        checks.push({ name: 'reachable', ok: true, detail: `${config.repo} responded` })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        checks.push({ name: 'reachable', ok: false, detail })
      }
    } else {
      checks.push({ name: 'reachable', ok: false, detail: 'skipped — credentials missing' })
    }

    const ok = checks.every((c) => c.ok)
    process.stdout.write(
      JSON.stringify({ tracker: config.tracker, repo: config.repo, checks, ok }) + '\n',
    )
    if (!ok) throw new Error('flight-rules check failed — see report above')
  })

  return check
}
