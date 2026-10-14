import { Command } from "commander";
import type { DocResolver } from "../../doc-resolver/doc-resolver.js";
import { type OperationRegistry } from "../../../operations/operation-registry.js";
import { DocOperation } from "../../../operations/doc-operation.js";
export interface DocCommandProps {
    getResolver: () => DocResolver;
    operation?: DocOperation;
    registry?: OperationRegistry;
}
export declare function createDocCommand(props: DocCommandProps): Command;
