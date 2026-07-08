import { Command, Option } from 'commander'
import type { CreateTicketInput, EntitySize, TaskTracker } from '../../task-tracker/task-tracker.js'
import { entitySizes } from '../../task-tracker/task-tracker.js'

type CreateTicketOptions = {
  title: string
  body: string
  epicId: string
  labels?: string
  assignee?: string
  size?: EntitySize
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
    .addOption(new Option('--size <size>', 'work size for the LLM-Context metadata').choices([...entitySizes]))
    .action(async (opts: CreateTicketOptions) => {
      const input: CreateTicketInput = {
        title: opts.title,
        body: opts.body,
        epicId: opts.epicId,
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
        ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
        ...(opts.size !== undefined ? { metadata: { size: opts.size } } : {}),
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
