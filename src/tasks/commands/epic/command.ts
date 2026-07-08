import { Command, Option } from 'commander'
import type { EntitySize, TaskTracker } from '../../task-tracker/task-tracker.js'
import { entitySizes } from '../../task-tracker/task-tracker.js'
import { DependencyPlannerService } from '../../dependency-planner/dependency-planner.js'

type CreateEpicOptions = { title: string; body: string; labels?: string; size?: EntitySize }

export function createEpicCommand(getTracker: () => TaskTracker): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'epic title')
    .requiredOption('--body <body>', 'epic body')
    .option('--labels <labels>', 'comma-separated labels')
    .addOption(new Option('--size <size>', 'work size for the LLM-Context metadata').choices([...entitySizes]))
    .action(async (opts: CreateEpicOptions) => {
      const result = await getTracker().createEpic({
        title: opts.title,
        body: opts.body,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
        ...(opts.size !== undefined ? { metadata: { size: opts.size } } : {}),
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
      const planner = new DependencyPlannerService()
      const plan = planner.plan(
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

  epic
    .command('link-initiative')
    .exitOverride()
    .argument('<epicId>', 'epic id')
    .requiredOption('--initiative <id>', 'initiative (milestone) id')
    .action(async (epicId: string, opts: { initiative: string }) => {
      await getTracker().linkEpicToInitiative(epicId, opts.initiative)
    })

  return epic
}
