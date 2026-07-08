import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

type CreateInitiativeOptions = { title: string; body: string }

export function createInitiativeCommand(getTracker: () => TaskTracker): Command {
  const initiative = new Command('initiative')

  initiative
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'initiative title')
    .requiredOption('--body <body>', 'initiative body')
    .action(async (opts: CreateInitiativeOptions) => {
      const result = await getTracker().createInitiative({ title: opts.title, body: opts.body })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  initiative
    .command('get')
    .exitOverride()
    .argument('<id>', 'initiative id')
    .action(async (id: string) => {
      const result = await getTracker().getInitiative(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return initiative
}
