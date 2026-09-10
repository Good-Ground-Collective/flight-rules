import { Command } from 'commander'
import type { CreateTicketInput, TaskTracker } from '../../task-tracker/task-tracker.js'
import { resolveBody } from '../resolve-body.js'
import { bodySectionsParser, type BodySections, type SectionKey } from '../../body-sections/body-sections.js'

// eslint-disable-next-line preflight/no-loose-functions -- collect is module-level behaviour awaiting a home on a service; tracked in KAN-39
function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

const sectionFields: Record<string, SectionKey> = {
  'problem-statement': 'problemStatement',
  solution: 'solution',
  'acceptance-criteria': 'acceptanceCriteria',
  'technical-writeup': 'technicalWriteup',
  'guided-walkthrough': 'guidedWalkthrough',
}

// eslint-disable-next-line preflight/no-loose-functions -- selectSection is module-level behaviour awaiting a home on a service; tracked in KAN-39
function selectSection(id: string, sections: BodySections, name: string): Record<string, unknown> {
  const field = sectionFields[name]
  if (field === undefined) {
    throw new Error(`unknown section "${name}" — expected one of: ${Object.keys(sectionFields).join(', ')}`)
  }
  return {
    id,
    section: name,
    markdown: sections[field] ?? null,
    ...(field === 'acceptanceCriteria' ? { items: sections.acceptanceCriteriaItems } : {}),
  }
}

type CreateTicketOptions = {
  title: string
  body?: string
  bodyFile?: string
  epicId?: string
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
    .option('--epic-id <id>', 'parent epic id; omit to create a standalone ticket')
    .option('--labels <labels>', 'comma-separated labels')
    .option('--assignee <user>', 'assignee login')
    .action(async (opts: CreateTicketOptions) => {
      const input: CreateTicketInput = {
        title: opts.title,
        body: resolveBody({ body: opts.body, bodyFile: opts.bodyFile }),
        labels: opts.labels !== undefined ? opts.labels.split(',') : [],
        ...(opts.epicId !== undefined ? { epicId: opts.epicId } : {}),
        ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
      }
      const result = await getTracker().createTicket(input)
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  ticket
    .command('get')
    .exitOverride()
    .argument('<id>', 'ticket id')
    .option('--section <name>', 'extract a single body section (e.g. acceptance-criteria)')
    .action(async (id: string, opts: { section?: string }) => {
      const result = await getTracker().getTicket(id)
      if (opts.section === undefined) {
        process.stdout.write(JSON.stringify(result) + '\n')
        return
      }
      const sections = bodySectionsParser.parse(result.body)
      process.stdout.write(JSON.stringify(selectSection(id, sections, opts.section)) + '\n')
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

  ticket
    .command('status')
    .exitOverride()
    .argument('<id>', 'ticket id to transition')
    .requiredOption('--to <status>', 'target status, e.g. "In Progress" or "In Review"')
    .action(async (id: string, opts: { to: string }) => {
      await getTracker().transitionTicket(id, opts.to)
      process.stdout.write(JSON.stringify({ id, status: opts.to }) + '\n')
    })

  ticket
    .command('transitions')
    .exitOverride()
    .argument('<id>', 'ticket id')
    .action(async (id: string) => {
      const transitions = await getTracker().listTransitions(id)
      process.stdout.write(JSON.stringify({ id, transitions }) + '\n')
    })

  ticket
    .command('label')
    .exitOverride()
    .argument('<id>', 'ticket id')
    .option('--add <label>', 'label to add (repeatable)', collect, [])
    .option('--remove <label>', 'label to remove (repeatable)', collect, [])
    .action(async (id: string, opts: { add: string[]; remove: string[] }) => {
      if (opts.add.length === 0 && opts.remove.length === 0) {
        throw new Error('ticket label needs at least one --add or --remove')
      }
      const tracker = getTracker()
      // Removals run first so a swap never leaves both lifecycle labels present if the addition fails.
      for (const label of opts.remove) await tracker.removeLabel(id, label)
      for (const label of opts.add) await tracker.addLabel(id, label)
      process.stdout.write(JSON.stringify({ id, added: opts.add, removed: opts.remove }) + '\n')
    })

  return ticket
}
