import { Command } from 'commander';
import type { PullRequestHost } from '../../pull-request-host/pull-request-host.js';
export declare function createPrCommand(getHost: () => PullRequestHost): Command;
