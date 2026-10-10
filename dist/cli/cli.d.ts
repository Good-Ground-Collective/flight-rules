import { type FlightRules } from '../flight-rules/flight-rules.js';
import { Command } from 'commander';
import type { Config } from '../shared/config.js';
import type { TaskTracker } from '../tasks/task-tracker/task-tracker.js';
import type { PullRequestHost } from '../pr/pull-request-host/pull-request-host.js';
export declare function buildProgram(getTracker: (overrideTracker?: string) => TaskTracker, getConfig: (overrideTracker?: string) => Config, getPrHost: (overrideTracker?: string) => PullRequestHost, getConfigPath?: () => string, services?: Pick<FlightRules, 'git' | 'probe' | 'docs' | 'configStore' | 'evidence' | 'board' | 'ariadneTokens' | 'boardSessions'>): Command;
export declare function run(argv: string[], flightRules?: FlightRules): Promise<void>;
