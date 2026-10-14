import { Command } from "commander";
import { z } from "zod";
import { type OperationRegistry } from "../../../operations/operation-registry.js";
declare const propsSchema: z.ZodObject<{
    registry: z.ZodCustom<OperationRegistry, OperationRegistry>;
}, z.core.$strict>;
export interface PrCommandAdapter {
    create(): Command;
}
/** Keeps Commander parsing at the edge and delegates validated PR behavior to the shared registry. */
export declare class CommanderPrCommand implements PrCommandAdapter {
    private readonly registry;
    constructor(props: z.input<typeof propsSchema>);
    create(): Command;
    private invokeAndPrint;
}
export declare function createPrCommand(registry: OperationRegistry): Command;
export {};
