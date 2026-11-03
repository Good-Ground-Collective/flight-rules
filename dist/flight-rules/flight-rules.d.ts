import { type DocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import { type GitExecutor } from "../git/git-executor/git-executor.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { ConfigStore } from "../shared/config-store.js";
import { type NativeInstallation } from "../plugins/native-installation/native-installation.js";
import { EvidenceLocation } from "../tasks/evidence/evidence-location.js";
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
}
export declare function createFlightRules(props?: FlightRulesProps): FlightRules;
