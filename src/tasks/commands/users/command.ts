import { Command } from 'commander'
import type { TaskTracker } from '../../task-tracker/task-tracker.js'

export function createUsersCommand(getTracker: () => TaskTracker): Command {
  const users = new Command('users')

  users
    .command('get')
    .exitOverride()
    .action(async () => {
      const result = await getTracker().getUsers()
      process.stdout.write(JSON.stringify(result) + '\n')
    })

  return users
}
