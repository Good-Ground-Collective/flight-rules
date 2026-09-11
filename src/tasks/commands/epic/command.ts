import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'
import { DependencyPlannerService } from '../../dependency-planner/dependency-planner.js'

type CreateEpicOptions = {
  title: string
  body?: string
  bodyFile?: string
  labels?: string
}

type EditEpicOptions = {
  body?: string
  bodyFile?: string
  title?: string
  labels?: string
}

export function createEpicCommand(getTracker: () => TaskTracker): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'epic title')
    .option('--body <body>', 'epic body (or use --body-file)')
    .option('--body-file <path>', 'read the epic body from a file')
    .option('--labels <labels>', 'comma-separated labels')
    .action(async (opts: CreateEpicOptions) => {
      const result = await getTracker().createEpic({
        title: opts.title,
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
      })
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  epic
    .command('edit')
    .exitOverride()
    .argument('<id>', 'epic id')
    .option('--body <body>', 'new epic body (or use --body-file)')
    .option('--body-file <path>', 'read the new epic body from a file')
    .option('--title <title>', 'new epic title (unchanged if omitted)')
    .option('--labels <labels>', 'comma-separated labels replacing existing free-form labels')
    .action(async (id: string, opts: EditEpicOptions) => {
      const result = await getTracker().updateEpicDescription(id, {
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.labels !== undefined ? { labels: opts.labels.split(',') } : {}),
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
