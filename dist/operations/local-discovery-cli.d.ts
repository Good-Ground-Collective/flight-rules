import type { Command } from "commander";
import { type OperationRegistry } from "./operation-registry.js";
export interface LocalDiscoveryCliProps {
    registry: OperationRegistry;
    readStdin?: () => Promise<string>;
}
export interface LocalDiscoveryCommandAdapter {
    addTo(program: Command): void;
}
/** Adapts Commander arguments and terminal rendering to the shared local operations. */
export declare class CommanderLocalDiscoveryCli implements LocalDiscoveryCommandAdapter {
    private readonly registry;
    private readonly readStdin;
    constructor(props: LocalDiscoveryCliProps);
    addTo(program: Command): void;
    private addCharter;
    private addCompetencies;
    private addRfc;
    private addQa;
    private addConfig;
    private addCheck;
    private writeRuntimeFailure;
    private invoke;
}
export declare class CharterSelectionError extends Error {
    name: string;
}
