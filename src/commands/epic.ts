import type { TaskTracker } from '../task-tracker/types.js'

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

export async function runEpicCommand(args: string[], tracker: TaskTracker): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'create') {
    const flags = parseFlags(args.slice(1))
    const epic = await tracker.createEpic({
      title: flags['title'] ?? '',
      body: flags['body'] ?? '',
      labels: flags['labels'] !== undefined ? flags['labels'].split(',') : [],
    })
    process.stdout.write(JSON.stringify(epic) + '\n')
    return
  }

  if (subcommand === 'get') {
    const epic = await tracker.getEpic(args[1] ?? '')
    process.stdout.write(JSON.stringify(epic) + '\n')
    return
  }

  process.stderr.write(`Unknown epic subcommand: ${subcommand ?? '(none)'}\n`)
  process.exit(1)
}
