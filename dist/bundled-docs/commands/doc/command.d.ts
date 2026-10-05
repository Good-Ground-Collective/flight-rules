import { Command } from 'commander';
import type { DocResolver } from '../../doc-resolver/doc-resolver.js';
export declare function createDocCommand(getResolver: () => DocResolver): Command;
