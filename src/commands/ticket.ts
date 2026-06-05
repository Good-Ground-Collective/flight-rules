import type { CreateTicketInput, TaskTracker } from '../task-tracker/types.js'

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg !== undefined && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        flags[key] = value
        i++
      }
    }
  }
  return flags
}

export async function runTicketCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const input: CreateTicketInput = {
      title: flags['title'] ?? '',
      body: flags['body'] ?? '',
      epicId: flags['epic-id'] ?? '',
      labels: flags['labels'] !== undefined ? flags['labels'].split(',') : [],
      ...(flags['assignee'] !== undefined ? { assignee: flags['assignee'] } : {}),
    }
    const ticket = await tracker.createTicket(input)
    process.stdout.write(JSON.stringify(ticket) + '\n')
    return
  }

  if (subcommand === 'get') {
    const ticket = await tracker.getTicket(args[1] ?? '')
    process.stdout.write(JSON.stringify(ticket) + '\n')
    return
  }

  process.stderr.write(`Unknown ticket subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
