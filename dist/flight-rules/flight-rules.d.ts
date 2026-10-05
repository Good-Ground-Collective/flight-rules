import { type DocResolver } from '../bundled-docs/doc-resolver/doc-resolver.js';
import { type GitExecutor } from '../git/git-executor/git-executor.js';
import type { PullRequestHost } from '../pr/pull-request-host/pull-request-host.js';
import type { Config } from '../shared/config.js';
import { ConfigStore } from '../shared/config-store.js';
import type { TaskTracker } from '../tasks/task-tracker/task-tracker.js';
import { type ToolProbe } from '../tasks/tool-probe/tool-probe.js';
import { type FlightRulesProps } from './flight-rules.schema.js';
export interface FlightRules {
    configPath(): string;
    configStore(): ConfigStore;
    config(overrideTracker?: string): Config;
    tracker(overrideTracker?: string): TaskTracker;
    prHost(overrideTracker?: string): PullRequestHost;
    git(): GitExecutor;
    probe(): ToolProbe;
    docs(): DocResolver;
}
/** Constructs services on demand so config and credentials are only required by their consumers. */
export declare class DefaultFlightRules implements FlightRules {
    private readonly cwd;
    private readonly env;
    private readonly explicitConfigPath;
    private readonly hostSettings;
    constructor(props?: FlightRulesProps);
    configPath(): string;
    configStore(): ConfigStore;
    config(overrideTracker?: string): Config;
    tracker(overrideTracker?: string): TaskTracker;
    prHost(overrideTracker?: string): PullRequestHost;
    git(): GitExecutor;
    probe(): ToolProbe;
    docs(): DocResolver;
}
export declare function createFlightRules(props?: FlightRulesProps): FlightRules;
