import { createFlightRules, type FlightRules } from "../flight-rules/flight-rules.js";
import { Command } from "commander";
import { createDocCommand } from "../bundled-docs/commands/doc/command.js";
import { DocOperation } from "../operations/doc-operation.js";
import { DefaultLocalDiscoveryOperations } from "../operations/local-discovery-operations.js";
import { LocalDiscoveryCli } from "../operations/local-discovery-cli.js";
import {
  LaunchOperationAccessPolicy,
  MapOperationRegistry,
} from "../operations/operation-registry.js";
import { DocCharterCatalog } from "../bundled-docs/charter-catalog/charter-catalog.js";
import { createReviewCommand } from "../code-review/commands/command.js";
import type { Config } from "../shared/config.js";
import { createBoardCommand } from "../shared/commands/board/command.js";
import { createPacketCommand } from "../shared/commands/packet/command.js";
import { createEpicCommand } from "../tasks/commands/epic/command.js";
import { createInitiativeCommand } from "../tasks/commands/initiative/command.js";
import { createTicketCommand } from "../tasks/commands/ticket/command.js";
import { createTddCommand } from "../tasks/commands/tdd/command.js";
import { createUsersCommand } from "../tasks/commands/users/command.js";
import { GitRepositoryPaths } from "../bundled-docs/charter-catalog/repository-paths.js";
import { createHookCommand } from "../hooks/commands/hook/command.js";
import { DetachedHeartbeatSender } from "../hooks/board-heartbeat/board-heartbeat.js";
import { BoardHookKit, GitBranchReader } from "../hooks/board-heartbeat/board-hook-kit.js";
import type { TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import { createGitCommand } from "../git/commands/commit/command.js";
import {
  createBranchNameCommand,
  createCommitMessageCommand,
} from "../git/commands/message/command.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import { createPrCommand } from "../pr/commands/pr/command.js";
import { appVersion } from "../version.js";
import { createAgentsCommand } from "../plugins/commands/agents/command.js";
import { cliRouteCoverage } from "../operations/cli-coverage.js";

export function buildProgram(
  getTracker: (overrideTracker?: string) => TaskTracker,
  getConfig: (overrideTracker?: string) => Config,
  getPrHost: (overrideTracker?: string) => PullRequestHost,
  getConfigPath: () => string = () => createFlightRules().configPath(),
  services: Pick<
    FlightRules,
    | "git"
    | "probe"
    | "readiness"
    | "docs"
    | "configStore"
    | "installation"
    | "evidence"
    | "board"
    | "packets"
    | "ariadneTokens"
    | "boardSessions"
    | "boardAgents"
  > = createFlightRules(),
): Command {
  const launchCwd = process.cwd();
  const program = new Command("flight-rules");
  program.version(appVersion);
  program.exitOverride();
  program.option("--tracker <tracker>", "override the configured tracker for this run");

  let overrideTracker: string | undefined;
  program.hook("preAction", () => {
    const value = program.opts()["tracker"];
    overrideTracker = typeof value === "string" ? value : undefined;
  });

  const tracker = (): TaskTracker => getTracker(overrideTracker);
  const config = (): Config => getConfig(overrideTracker);
  const prHost = (): PullRequestHost => getPrHost(overrideTracker);

  program.addCommand(createEpicCommand(tracker, prHost, config));
  program.addCommand(createInitiativeCommand(tracker, prHost, config));
  program.addCommand(createTicketCommand(tracker));
  program.addCommand(createTddCommand(tracker));
  program.addCommand(createGitCommand(() => services.git()));
  program.addCommand(createCommitMessageCommand());
  program.addCommand(createBranchNameCommand());
  program.addCommand(createPrCommand(prHost));
  program.addCommand(createUsersCommand(tracker));
  program.addCommand(createAgentsCommand(() => services.installation()));
  const boardHooks = (): BoardHookKit =>
    new BoardHookKit({
      sessions: services.boardSessions(),
      agents: services.boardAgents(),
      board: () => services.board(),
    });
  program.addCommand(
    createHookCommand(undefined, undefined, {
      heartbeatHook: () => boardHooks().heartbeatHook(),
      dispatchHook: () => boardHooks().dispatchHook(),
      sender: () => new DetachedHeartbeatSender(),
      board: () => services.board(),
      branch: () => new GitBranchReader(),
    }),
  );
  const docOperation = new DocOperation({ getResolver: () => services.docs() });
  const localOperations = new DefaultLocalDiscoveryOperations({
    cwd: launchCwd,
    getConfig: config,
    getConfigStore: () => services.configStore(),
    getCharters: () => new DocCharterCatalog({ docs: services.docs() }),
    getRepositoryPaths: () => new GitRepositoryPaths({ cwd: launchCwd }),
    getEvidence: () => services.evidence(),
    getReadiness: () => services.readiness(),
    getProbe: () => services.probe(),
    getTracker: tracker,
    getConfigPath,
  });
  const operationRegistry = new MapOperationRegistry({
    operations: [docOperation, ...localOperations.operations()],
    policy: new LaunchOperationAccessPolicy({ allowedEffects: ["read", "process", "network"] }),
  });
  new LocalDiscoveryCli({ operations: localOperations, registry: operationRegistry }).addTo(
    program,
  );
  program.addCommand(
    createDocCommand({
      getResolver: () => services.docs(),
      operation: docOperation,
      registry: operationRegistry,
    }),
  );
  program.addCommand(createReviewCommand());
  program.addCommand(
    createBoardCommand(
      () => services.board(),
      () => services.ariadneTokens(),
    ),
  );
  program.addCommand(createPacketCommand(() => services.packets()));
  cliRouteCoverage.check(program, operationRegistry);
  return program;
}

// eslint-disable-next-line preflight/no-loose-functions -- run is module-level behaviour awaiting a home on a service; tracked in KAN-39
export async function run(
  argv: string[],
  flightRules: FlightRules = createFlightRules(),
): Promise<void> {
  await buildProgram(
    (override) => flightRules.tracker(override),
    (override) => flightRules.config(override),
    (override) => flightRules.prHost(override),
    () => flightRules.configPath(),
    flightRules,
  ).parseAsync(argv, {
    from: "user",
  });
}
