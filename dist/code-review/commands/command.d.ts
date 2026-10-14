import { Command } from "commander";
import { type OperationRegistry } from "../../operations/operation-registry.js";
import type { ReviewOperationsLaunchProps } from "../../operations/review-operations.js";
export interface ReviewCommandProps {
    registry: OperationRegistry;
    defaultCwd: string;
    createTrustedRegistry(props: ReviewOperationsLaunchProps): OperationRegistry;
}
export interface ReviewCommandAdapter {
    create(): Command;
}
/** Adapts review CLI file arguments and output formatting to shared in-process operations. */
export declare class CommanderReviewCommand implements ReviewCommandAdapter {
    private readonly registry;
    private readonly defaultCwd;
    private readonly createTrustedRegistry;
    constructor(props: ReviewCommandProps);
    create(): Command;
    private invoke;
    private invokeWithRegistry;
}
export declare function createReviewCommand(props: ReviewCommandProps): Command;
