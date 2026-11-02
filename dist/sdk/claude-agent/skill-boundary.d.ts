import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { PendingQuestion } from "../skill-runtime-core.js";
export interface ToolTurnCall {
    id: string;
    name: string;
}
/** Groups the tool calls the model made in each assistant turn so a call can be judged against its siblings in the same turn. */
export declare class ToolTurnObserver {
    private readonly turns;
    private readonly turnByCall;
    private readonly waiting;
    private closed;
    observe(message: unknown): void;
    /** The calls made in the same turn as this one, or undefined when the model's turn never reached the host. */
    turnOf(toolUseId: string): Promise<readonly ToolTurnCall[] | undefined>;
    close(): void;
}
export interface ResumedAnswer {
    toolUseId: string;
    answer: string;
}
export interface DeferredQuestion extends PendingQuestion {
    toolUseId: string;
}
export interface QuestionBoundaryProps {
    askTool: string;
    aloneTools: readonly string[];
    turns: ToolTurnObserver;
    ask: (args: {
        question: string;
    }) => Promise<PendingQuestion>;
    resumed?: ResumedAnswer | undefined;
}
/** Pauses a skill at a human question and later returns the human's answer to that same call, never an answer the model made up. */
export declare class QuestionBoundary {
    private readonly props;
    private releasedAnswer;
    private deferredQuestion;
    constructor(props: QuestionBoundaryProps);
    get deferred(): DeferredQuestion | undefined;
    /** Hands back the human's answer once, only after the boundary released it for the resumed call. */
    takeAnswer(): string | undefined;
    preToolUse(input: HookInput): Promise<HookJSONOutput>;
    private handleQuestion;
    private refuse;
    private deny;
}
