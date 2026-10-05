import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'
import { portableContextGuard } from '../../portable-context/portable-context.js'

type CreateTddOptions = { title: string; body?: string; bodyFile?: string; epicId: string; allowLocalPaths?: boolean }

export function createTddCommand(getTracker: () => TaskTracker): Command {
  const tdd = new Command('tdd')

  tdd
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'tdd title')
    .option('--body <body>', 'tdd body (or use --body-file)')
    .option('--body-file <path>', 'read the tdd body from a file')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .option('--allow-local-paths', 'accept machine-local paths in the body (see docs/layered-body-format.md)')
    .action(async (opts: CreateTddOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile })
      portableContextGuard.assertPortable(body, { allowLocalPaths: opts.allowLocalPaths })
      const result = await getTracker().createTechnicalDesign({
        title: opts.title,
        body,
        epicId: opts.epicId,
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  tdd
    .command('get')
    .exitOverride()
    .argument('<id>', 'tdd id')
    .action(async (id: string) => {
      const result = await getTracker().getTechnicalDesign(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return tdd
}
