import { Command } from 'commander'
import type { CreateTicketInput, TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'

type CreateTicketOptions = {
  title: string
  body?: string
  bodyFile?: string
  epicId: string
  labels?: string
  assignee?: string
}

export function createTicketCommand(getTracker: () => TaskTracker): Command {
  const ticket = new Command('ticket')

  ticket
    .command('create')
    .exitOverride()
    .requiredOption('--title <title>', 'ticket title')
    .option('--body <body>', 'ticket body (or use --body-file)')
    .option('--body-file <path>', 'read the ticket body from a file')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .option('--labels <labels>', 'comma-separated labels')
    .option('--assignee <user>', 'assignee login')
    .action(async (opts: CreateTicketOptions) => {
      const input: CreateTicketInput = {
        title: opts.title,
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
        epicId: opts.epicId,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
        ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
      }
      const result = await getTracker().createTicket(input)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  ticket
    .command('get')
    .exitOverride()
    .argument('<id>', 'ticket id')
    .action(async (id: string) => {
      const result = await getTracker().getTicket(id)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  ticket
    .command('block')
    .exitOverride()
    .argument('<id>', 'ticket id to block')
    .requiredOption('--by <blockerId>', 'id of the ticket that must close first')
    .action(async (id: string, opts: { by: string }) => {
      await getTracker().blockTicket(id, opts.by)
    })

  ticket
    .command('unblock')
    .exitOverride()
    .argument('<id>', 'ticket id to unblock')
    .requiredOption('--by <blockerId>', 'id of the blocking ticket to remove')
    .action(async (id: string, opts: { by: string }) => {
      await getTracker().unblockTicket(id, opts.by)
    })

  return ticket
}
