import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'

type CreateInitiativeOptions = { title: string; body?: string; bodyFile?: string }
type EditInitiativeOptions = { body?: string; bodyFile?: string; title?: string }

export function createInitiativeCommand(getTracker: () => TaskTracker): Command {
  const initiative = new Command('initiative')

  initiative
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'initiative title')
    .option('--body <body>', 'initiative body (or use --body-file)')
    .option('--body-file <path>', 'read the initiative body from a file')
    .action(async (opts: CreateInitiativeOptions) => {
      const result = await getTracker().createInitiative({
        title: opts.title,
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  initiative
    .command('edit')
    .exitOverride()
    .argument('<id>', 'initiative id')
    .option('--body <body>', 'new initiative body (or use --body-file)')
    .option('--body-file <path>', 'read the new initiative body from a file')
    .option('--title <title>', 'new initiative title (unchanged if omitted)')
    .action(async (id: string, opts: EditInitiativeOptions) => {
      const result = await getTracker().updateInitiativeDescription(id, {
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
        ...(opts.title !== undefined ? { title: opts.title } : {}),
      })
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
