import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

export function createEpicCommand(getTracker: () => TaskTracker): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .requiredOption('--title <title>', 'epic title')
    .requiredOption('--body <body>', 'epic body')
    .option('--labels <labels>', 'comma-separated labels')
    .action(async (opts: { title: string; body: string; labels?: string }) => {
      const result = await getTracker().createEpic({
        title: opts.title,
        body: opts.body,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  epic
    .command('get')
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const result = await getTracker().getEpic(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return epic
}
