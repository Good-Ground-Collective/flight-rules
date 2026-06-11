import { Command } from 'commander'
import type { CreateTicketInput, TaskTracker } from '../../task-tracker/task-tracker.js'

type CreateTicketOptions = {
  title: string
  body: string
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
    .requiredOption('--body <body>', 'ticket body')
    .requiredOption('--epic-id <id>', 'parent epic id')
    .option('--labels <labels>', 'comma-separated labels')
    .option('--assignee <user>', 'assignee login')
    .action(async (opts: CreateTicketOptions) => {
      const input: CreateTicketInput = {
        title: opts.title,
        body: opts.body,
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

  return ticket
}
