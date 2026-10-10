import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AriadneRequest, AriadneResponse, AriadneTransport } from "../ariadne-transport.js";

type Reply = AriadneResponse | Error | ((request: AriadneRequest) => AriadneResponse | Error);

/** Records every request and answers from a queue; an empty queue answers 200 `{}`. */
export class FakeTransport implements AriadneTransport {
  readonly requests: AriadneRequest[] = [];
  private readonly replies: Reply[];

  constructor(...replies: Reply[]) {
    this.replies = replies;
  }

  send(request: AriadneRequest): Promise<AriadneResponse> {
    this.requests.push(request);
    const next = this.replies.shift() ?? { status: 200, body: "{}" };
    const reply = typeof next === "function" ? next(request) : next;
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  }

  bodies(): unknown[] {
    return this.requests.map((request) => (request.body === undefined ? undefined : JSON.parse(request.body)));
  }

  static json(status: number, body: unknown): AriadneResponse {
    return { status, body: JSON.stringify(body) };
  }
}

export interface ContractRecords {
  session: Record<string, unknown>;
  item: Record<string, unknown>;
  activity: Record<string, unknown>;
}

/** Response records shaped exactly as the contract's "Reading and answering" section prints them. */
export const contract: ContractRecords = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "contract-records.json"), "utf-8"),
);

/** A well-formed agent token that no server has ever issued. */
export const agentToken = `ariadne_agent_0123456789abcdef_${"A".repeat(43)}`;
