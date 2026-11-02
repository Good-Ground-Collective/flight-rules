import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PendingQuestion } from "../skill-runtime-core.js";

const AssistantToolUsesSchema = z.looseObject({
  type: z.literal("assistant"),
  parent_tool_use_id: z.string().nullish(),
  message: z.looseObject({
    id: z.string(),
    content: z.array(
      z.looseObject({ type: z.string(), id: z.string().optional(), name: z.string().optional() }),
    ),
  }),
});
const AskInputSchema = z.looseObject({ question: z.string().min(1) });

export interface ToolTurnCall {
  id: string;
  name: string;
}

/** Groups the tool calls the model made in each assistant turn so a call can be judged against its siblings in the same turn. */
export class ToolTurnObserver {
  private readonly turns = new Map<string, ToolTurnCall[]>();
  private readonly turnByCall = new Map<string, string>();
  private readonly waiting = new Map<string, (() => void)[]>();
  private closed = false;

  observe(message: unknown): void {
    const parsed = AssistantToolUsesSchema.safeParse(message);
    if (!parsed.success || (parsed.data.parent_tool_use_id ?? null) !== null) return;

    const turnId = parsed.data.message.id;
    const calls = this.turns.get(turnId) ?? [];
    for (const block of parsed.data.message.content) {
      if (block.type !== "tool_use" || block.id === undefined) continue;
      calls.push({ id: block.id, name: block.name ?? "" });
      this.turnByCall.set(block.id, turnId);
    }
    this.turns.set(turnId, calls);

    for (const call of calls) {
      for (const resolve of this.waiting.get(call.id) ?? []) resolve();
      this.waiting.delete(call.id);
    }
  }

  /** The calls made in the same turn as this one, or undefined when the model's turn never reached the host. */
  async turnOf(toolUseId: string): Promise<readonly ToolTurnCall[] | undefined> {
    if (!this.turnByCall.has(toolUseId) && !this.closed) {
      await new Promise<void>((resolve) => {
        this.waiting.set(toolUseId, [...(this.waiting.get(toolUseId) ?? []), resolve]);
      });
    }
    const turnId = this.turnByCall.get(toolUseId);
    if (turnId === undefined) return undefined;

    // The turn's remaining blocks are already queued behind this one; a macrotask lets them drain first.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return [...(this.turns.get(turnId) ?? [])];
  }

  close(): void {
    this.closed = true;
    for (const resolvers of this.waiting.values()) {
      for (const resolve of resolvers) resolve();
    }
    this.waiting.clear();
  }
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
  ask: (args: { question: string }) => Promise<PendingQuestion>;
  resumed?: ResumedAnswer | undefined;
}

/** Pauses a skill at a human question and later returns the human's answer to that same call, never an answer the model made up. */
export class QuestionBoundary {
  private readonly props: QuestionBoundaryProps;
  private releasedAnswer: string | undefined;
  private deferredQuestion: DeferredQuestion | undefined;

  constructor(props: QuestionBoundaryProps) {
    this.props = props;
  }

  get deferred(): DeferredQuestion | undefined {
    return this.deferredQuestion;
  }

  /** Hands back the human's answer once, only after the boundary released it for the resumed call. */
  takeAnswer(): string | undefined {
    const answer = this.releasedAnswer;
    this.releasedAnswer = undefined;
    return answer;
  }

  async preToolUse(input: HookInput): Promise<HookJSONOutput> {
    if (input.hook_event_name !== "PreToolUse") return {};

    if (this.props.resumed?.toolUseId === input.tool_use_id) return this.handleQuestion(input);

    const turn = await this.props.turns.turnOf(input.tool_use_id);
    const isAloneTool = this.props.aloneTools.includes(input.tool_name);
    const sharesTurnWithAlone = turn?.some((call) => this.props.aloneTools.includes(call.name));
    if (turn === undefined && isAloneTool) return this.refuse(input.tool_name);
    if (turn !== undefined && turn.length > 1 && (isAloneTool || sharesTurnWithAlone)) {
      return this.refuse(input.tool_name);
    }
    if (input.tool_name !== this.props.askTool) return {};

    return this.handleQuestion(input);
  }

  private async handleQuestion(
    input: Extract<HookInput, { hook_event_name: "PreToolUse" }>,
  ): Promise<HookJSONOutput> {
    const parsed = AskInputSchema.safeParse(input.tool_input);
    if (!parsed.success) return this.deny("A human question needs a question text.");

    const resumed = this.props.resumed;
    if (resumed !== undefined && resumed.toolUseId === input.tool_use_id) {
      this.releasedAnswer = resumed.answer;
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { question: parsed.data.question, answer: resumed.answer },
        },
      };
    }
    if ("answer" in parsed.data) return this.deny("Only the human caller can supply an answer.");

    try {
      const pending = await this.props.ask({ question: parsed.data.question });
      this.deferredQuestion = { ...pending, toolUseId: input.tool_use_id };
    } catch (cause) {
      return this.deny(cause instanceof Error ? cause.message : String(cause));
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } };
  }

  private refuse(toolName: string): HookJSONOutput {
    return this.deny(
      `${toolName} must be the only tool call in its turn. Other calls in this turn may already have run; call it alone.`,
    );
  }

  private deny(reason: string): HookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  }
}
