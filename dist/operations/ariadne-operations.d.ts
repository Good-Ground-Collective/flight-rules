import { z } from "zod";
import type { AriadneBoard } from "../shared/ariadne/ariadne-board.js";
import type { AriadnePackets } from "../shared/ariadne/ariadne-packets.js";
import type { OperationDescriptor } from "./operation-registry.js";
declare const AriadneOperationsPropsSchema: z.ZodObject<{
    getBoard: z.ZodCustom<() => AriadneBoard, () => AriadneBoard>;
    getPackets: z.ZodCustom<() => AriadnePackets, () => AriadnePackets>;
}, z.core.$strip>;
export interface AriadneOperations {
    operations(): OperationDescriptor[];
}
/** Shares Ariadne board and packet behavior across CLI and programmatic callers. */
export declare class DefaultAriadneOperations implements AriadneOperations {
    private readonly props;
    constructor(props: z.input<typeof AriadneOperationsPropsSchema>);
    operations(): OperationDescriptor[];
    private boardOptions;
    private mapBoard;
    private descriptor;
}
export {};
