import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

type CreateTddOptions = { title: string; body: string; epicId: string }

export function createTddCommand(getTracker: () => TaskTracker): Command {
  const tdd = new Command('tdd')

  tdd
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'tdd title')
    .requiredOption('--body <body>', 'tdd body')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .action(async (opts: CreateTddOptions) => {
      const result = await getTracker().createTechnicalDesign({
        title: opts.title,
        body: opts.body,
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
