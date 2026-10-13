import { Command } from 'commander';
import type { CharterCatalog } from '../../charter-catalog/charter-catalog.js';
import type { RepositoryPaths } from '../../charter-catalog/repository-paths.js';
/**
 * Prints the core coding charter plus every language charter governing the selected files.
 * The core is never printed alone, so callers cannot drop the language charters by accident.
 */
export declare function createCharterCommand(getCatalog: () => CharterCatalog, getPaths: () => RepositoryPaths, readStdin?: () => Promise<string>): Command;
export declare class CharterSelectionError extends Error {
    name: string;
}
