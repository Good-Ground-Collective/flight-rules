import { createFlightRules, type FlightRules } from '../flight-rules/flight-rules.js'
import { Command } from 'commander'
import { createDocCommand } from '../bundled-docs/commands/doc/command.js'
import type { Config } from '../shared/config.js'
import { createConfigCommand } from '../shared/commands/config/command.js'
import { createBoardCommand } from '../shared/commands/board/command.js'
import { createEpicCommand } from '../tasks/commands/epic/command.js'
import { createInitiativeCommand } from '../tasks/commands/initiative/command.js'
import { createTicketCommand } from '../tasks/commands/ticket/command.js'
import { createTddCommand } from '../tasks/commands/tdd/command.js'
import { createUsersCommand } from '../tasks/commands/users/command.js'
import { createRfcCommand } from '../tasks/commands/rfc/command.js'
import { createQaCommand } from '../tasks/commands/qa/command.js'
import { createCompetenciesCommand } from '../tasks/commands/competencies/command.js'
import { createCheckCommand } from '../tasks/commands/check/command.js'
import { createHookCommand } from '../hooks/commands/hook/command.js'
import type { TaskTracker } from '../tasks/task-tracker/task-tracker.js'
import { createGitCommand } from '../git/commands/commit/command.js'
import { createBranchNameCommand, createCommitMessageCommand } from '../git/commands/message/command.js'
import type { PullRequestHost } from '../pr/pull-request-host/pull-request-host.js'
import { createPrCommand } from '../pr/commands/pr/command.js'
import { appVersion } from '../version.js'

export function buildProgram(
  getTracker: (overrideTracker?: string) => TaskTracker,
  getConfig: (overrideTracker?: string) => Config,
  getPrHost: (overrideTracker?: string) => PullRequestHost,
  getConfigPath: () => string = () => createFlightRules().configPath(),
  services: Pick<FlightRules, 'git' | 'probe' | 'docs' | 'configStore' | 'evidence' | 'board' | 'ariadneTokens'> = createFlightRules(),
): Command {
  const program = new Command('flight-rules')
  program.version(appVersion)
  program.exitOverride()
  program.option('--tracker <tracker>', 'override the configured tracker for this run')

  let overrideTracker: string | undefined
  program.hook('preAction', () => {
    const value = program.opts()['tracker']
    overrideTracker = typeof value === 'string' ? value : undefined
  })

  const tracker = (): TaskTracker => getTracker(overrideTracker)
  const config = (): Config => getConfig(overrideTracker)
  const prHost = (): PullRequestHost => getPrHost(overrideTracker)

  program.addCommand(createEpicCommand(tracker))
  program.addCommand(createInitiativeCommand(tracker))
  program.addCommand(createTicketCommand(tracker))
  program.addCommand(createTddCommand(tracker))
  program.addCommand(createGitCommand(() => services.git()))
  program.addCommand(createCommitMessageCommand())
  program.addCommand(createBranchNameCommand())
  program.addCommand(createPrCommand(prHost))
  program.addCommand(createUsersCommand(tracker))
  program.addCommand(createRfcCommand(config))
  program.addCommand(createConfigCommand(() => services.configStore()))
  program.addCommand(createHookCommand())
  program.addCommand(createQaCommand(config, getConfigPath, undefined, () => services.evidence()))
  program.addCommand(createCompetenciesCommand(config))
  program.addCommand(createDocCommand(() => services.docs()))
  program.addCommand(createCheckCommand(config, tracker, getConfigPath, () => services.probe()))
  program.addCommand(createBoardCommand(() => services.board(), () => services.ariadneTokens()))
  return program
}

// eslint-disable-next-line preflight/no-loose-functions -- run is module-level behaviour awaiting a home on a service; tracked in KAN-39
export async function run(argv: string[], flightRules: FlightRules = createFlightRules()): Promise<void> {
  await buildProgram(
    (override) => flightRules.tracker(override),
    (override) => flightRules.config(override),
    (override) => flightRules.prHost(override),
    () => flightRules.configPath(),
    flightRules,
  ).parseAsync(argv, {
    from: 'user',
  })
}
