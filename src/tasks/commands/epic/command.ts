import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import { planDependencies } from '../../dependency-planner/dependency-planner.js'

type CreateEpicOptions = { title: string; body: string; labels?: string }

export function createEpicCommand(getTracker: () => TaskTracker): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'epic title')
    .requiredOption('--body <body>', 'epic body')
    .option('--labels <labels>', 'comma-separated labels')
    .action(async (opts: CreateEpicOptions) => {
      const result = await getTracker().createEpic({
        title: opts.title,
        body: opts.body,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  epic
    .command('get')
    .exitOverride()
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const result = await getTracker().getEpic(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  epic
    .command('plan')
    .exitOverride()
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const epicData = await getTracker().getEpic(id)
      const plan = planDependencies(
        epicData.childIssues.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          blockedBy: ticket.blockedBy,
        })),
      )
      process.stdout.write(JSON.stringify(plan) + '\n')
      if (plan.cycles.length > 0) {
        throw new Error(`dependency cycle detected among tickets: ${plan.cycles.join(', ')}`)
      }
    })

  return epic
}
