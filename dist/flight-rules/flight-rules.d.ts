import { type DocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import { type GitExecutor } from "../git/git-executor/git-executor.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { ConfigStore } from "../shared/config-store.js";
import { type NativeInstallation } from "../plugins/native-installation/native-installation.js";
import { EvidenceLocation } from "../tasks/evidence/evidence-location.js";
import { AriadneBoard } from "../shared/ariadne/ariadne-board.js";
import { AriadnePackets } from "../shared/ariadne/ariadne-packets.js";
import { AriadneTokenStore } from "../shared/ariadne/ariadne-token-store.js";
import { BoardAgentStore } from "../shared/ariadne/board-agent-store.js";
import { BoardSessionStore } from "../shared/ariadne/board-session-store.js";
import type { TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import { type ToolProbe } from "../tasks/tool-probe/tool-probe.js";
import { type RepositoryReadiness } from "../tasks/readiness/repository-readiness.js";
import { type FlightRulesProps } from "./flight-rules.schema.js";
import { type LocalDiscoveryOperations } from "../operations/local-discovery-operations.js";
import { type ConfigOperationPolicy, type GitConfigOperations } from "../operations/git-config-operations.js";
import { type ReviewOperations, type ReviewOperationsLaunchProps } from "../operations/review-operations.js";
import type { TrackerEntityOperations } from "../operations/tracker-entity-operations.js";
export interface FlightRules {
    installation(): NativeInstallation;
    configPath(): string;
    configStore(): ConfigStore;
    /** The main checkout when the working directory is a linked git worktree. */
    mainCheckout(): string | undefined;
    evidence(): EvidenceLocation;
    config(overrideTracker?: string): Config;
    tracker(overrideTracker?: string): TaskTracker;
    prHost(overrideTracker?: string): PullRequestHost;
    git(): GitExecutor;
    probe(): ToolProbe;
    readiness(): RepositoryReadiness;
    docs(): DocResolver;
    localOperations(): LocalDiscoveryOperations;
    gitConfigOperations(policy?: ConfigOperationPolicy): GitConfigOperations;
    reviewOperations(props?: ReviewOperationsLaunchProps): ReviewOperations;
    trackerEntityOperations(): TrackerEntityOperations;
    /** Ariadne's Agents page reporter; reads only the `ariadne.*` keys from user and local scope, so it works without a valid tracker config. */
    board(): AriadneBoard;
    packets(): AriadnePackets;
    ariadneTokens(): AriadneTokenStore;
    /** The last heartbeat each session's skill posted, outside every repo; read by the heartbeat hook. */
    boardSessions(): BoardSessionStore;
    /** Which Jira ticket each sub-agent works on, outside every repo; written and read by the board hooks. */
    boardAgents(): BoardAgentStore;
}
/** Constructs services on demand so config and credentials are only required by their consumers. */
export declare class DefaultFlightRules implements FlightRules {
    private readonly cwd;
    private readonly env;
    private readonly launchEnv;
    private readonly gitEnv;
    private readonly explicitConfigPath;
    private readonly hostSettings;
    private readonly host;
    private readonly configWritePolicy;
    private untrackedRoot;
    constructor(props?: FlightRulesProps);
    configPath(): string;
    configStore(): ConfigStore;
    installation(): NativeInstallation;
    /** Looked up once per instance. */
    mainCheckout(): string | undefined;
    evidence(): EvidenceLocation;
    config(overrideTracker?: string): Config;
    tracker(overrideTracker?: string): TaskTracker;
    prHost(overrideTracker?: string): PullRequestHost;
    git(): GitExecutor;
    gitConfigOperations(policy?: ConfigOperationPolicy): GitConfigOperations;
    probe(): ToolProbe;
    readiness(): RepositoryReadiness;
    docs(): DocResolver;
    localOperations(): LocalDiscoveryOperations;
    reviewOperations(props?: ReviewOperationsLaunchProps): ReviewOperations;
    trackerEntityOperations(): TrackerEntityOperations;
    board(): AriadneBoard;
    packets(): AriadnePackets;
    ariadneTokens(): AriadneTokenStore;
    boardSessions(): BoardSessionStore;
    boardAgents(): BoardAgentStore;
}
export declare function createFlightRules(props?: FlightRulesProps): FlightRules;
