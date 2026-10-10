import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'
import { portableContextGuard } from '../../portable-context/portable-context.js'
import type { PullRequestHost } from '../../../pr/pull-request-host/pull-request-host.js'
import type { Config } from '../../../shared/config.js'
import { ReviewPlanService } from '../../review-plan/review-plan.js'
import { DependencyPlannerService } from '../../dependency-planner/dependency-planner.js'

type CreateEpicOptions = {
  title: string
  body?: string
  bodyFile?: string
  labels?: string
  allowLocalPaths?: boolean
}

type EditEpicOptions = {
  body?: string
  bodyFile?: string
  title?: string
  labels?: string
  allowLocalPaths?: boolean
}

export function createEpicCommand(
  getTracker: () => TaskTracker,
  getPrHost: () => PullRequestHost,
  getConfig: () => Pick<Config, 'inReviewStatus'> = () => ({}),
): Command {
  const epic = new Command('epic')

  epic
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'epic title')
    .option('--body <body>', 'epic body (or use --body-file)')
    .option('--body-file <path>', 'read the epic body from a file')
    .option('--labels <labels>', 'comma-separated labels')
    .option('--allow-local-paths', 'accept machine-local paths in the body (see docs/layered-body-format.md)')
    .action(async (opts: CreateEpicOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile })
      portableContextGuard.assertPortable(body, { allowLocalPaths: opts.allowLocalPaths })
      const result = await getTracker().createEpic({
        title: opts.title,
        body,
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
    .option('--allow-local-paths', 'accept machine-local paths in the body (see docs/layered-body-format.md)')
    .action(async (id: string, opts: EditEpicOptions) => {
      const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile })
      portableContextGuard.assertPortable(body, { allowLocalPaths: opts.allowLocalPaths })
      const result = await getTracker().updateEpicDescription(id, {
        body,
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
    .command('review-plan')
    .exitOverride()
    .argument('<id>', 'epic id')
    .action(async (id: string) => {
      const epicData = await getTracker().getEpic(id)
      const plan = new DependencyPlannerService().plan(
        epicData.childIssues.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          blockedBy: ticket.blockedBy,
        })),
      )
      const { inReviewStatus } = getConfig()
      const reviewPlan = new ReviewPlanService()
      const inReviewIds = reviewPlan.inReviewTicketIds(plan, inReviewStatus)

      const host = getPrHost()
      const pullRequests = inReviewIds.length > 0 ? await host.listOpenPullRequestsForTickets(inReviewIds) : []
      const defaultBranch = await host.defaultBranch()

      const result = reviewPlan.build({
        plan,
        tickets: epicData.childIssues,
        pullRequests,
        defaultBranch,
        inReviewStatus,
      })
      process.stdout.write(
        JSON.stringify({
          epic: { id: epicData.id, title: epicData.title },
          defaultBranch,
          route: result.route,
          reasons: result.reasons,
          blocked: result.blocked,
          unblocksOnMerge: result.unblocksOnMerge,
        }) + '\n',
      )
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
