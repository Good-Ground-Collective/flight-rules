import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardAgentStore } from "../../../shared/ariadne/board-agent-store.js";
import { AgentTicketResolver } from "../agent-ticket-resolver.js";

// The bridge from a sub-agent's tool call back to the Agent call that started
// it: meta.json names the dispatch's tool_use_id; without it, the sub-agent's
// first user message is the prompt the dispatch hook saw.

describe("AgentTicketResolver", () => {
  let home: string;
  let subagents: string;
  const now = 1_000_000;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fr-agent-resolver-"));
    subagents = join(home, "projects", "session-1", "subagents");
    mkdirSync(subagents, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const agents = () => new BoardAgentStore({ env: {}, home, now: () => now });
  const resolver = () => new AgentTicketResolver({ agents: agents() });
  let location: { agentId: string; session: string; transcriptPath?: string | undefined; agentType: string };
  beforeEach(() => {
    location = { agentId: "a1", session: "session-1", transcriptPath: join(home, "projects", "session-1.jsonl"), agentType: "general-purpose" };
  });
  const meta = (value: Record<string, unknown>) => writeFileSync(join(subagents, "agent-a1.meta.json"), JSON.stringify(value));
  const transcript = (...lines: unknown[]) =>
    writeFileSync(join(subagents, "agent-a1.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  it("follows meta.json's toolUseId to the dispatch record", () => {
    agents().recordDispatch("toolu_1", { ticket: "FRT-1", description: "Build FRT-1 api", session: "session-1", at: now });
    meta({ agentType: "general-purpose", description: "something else", toolUseId: "toolu_1" });
    expect(resolver().resolve(location)).toEqual({
      ticket: "FRT-1",
      description: "Build FRT-1 api",
      agentType: "general-purpose",
      toolUseId: "toolu_1",
      session: "session-1",
      at: now,
    });
  });

  it("reads the meta description when there is no dispatch record", () => {
    meta({ agentType: "Explore", description: "Look at FRT-22", toolUseId: "toolu_unknown" });
    expect(resolver().resolve(location)).toMatchObject({ ticket: "FRT-22", description: "Look at FRT-22", agentType: "Explore" });
  });

  it("falls back to the first user message when meta.json is missing", () => {
    transcript(
      { type: "system", message: { role: "system", content: "x" } },
      { type: "user", message: { role: "user", content: "Read FRT-1. You are building ticket FRT-2." } },
      { type: "user", message: { role: "user", content: "FRT-3" } },
    );
    expect(resolver().resolve(location)).toMatchObject({ ticket: "FRT-2" });
  });

  it("matches the fallback prompt to its dispatch record, taking its ticket and description", () => {
    const prompt = "Implement the change described in the plan.";
    agents().recordDispatch("toolu_1", {
      ticket: "FRT-9",
      description: "Build FRT-9 api",
      session: "session-1",
      promptDigest: resolver().digest(prompt),
      at: now,
    });
    transcript({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
    expect(resolver().resolve(location)).toMatchObject({ ticket: "FRT-9", description: "Build FRT-9 api" });
  });

  it("finds the files from SubagentStop's agent_transcript_path alone", () => {
    meta({ description: "Build FRT-4" });
    expect(resolver().resolve({ agentId: "a1", session: "session-1", agentTranscriptPath: join(subagents, "agent-a1.jsonl") })).toMatchObject({
      ticket: "FRT-4",
    });
  });

  it("caches the answer, so later calls read no sub-agent files", () => {
    meta({ description: "Build FRT-4" });
    expect(resolver().resolve(location)?.ticket).toBe("FRT-4");
    meta({ description: "Build FRT-5" });
    expect(resolver().resolve(location)?.ticket).toBe("FRT-4");
  });

  it("returns undefined, caching nothing, before Claude Code has written either file, and for an unsafe agent id", () => {
    expect(resolver().resolve(location)).toBeUndefined();
    expect(agents().readAgent("a1")).toBeUndefined();
    expect(resolver().resolve({ ...location, agentId: "../a1" })).toBeUndefined();
    expect(resolver().resolve({ ...location, transcriptPath: undefined })).toBeUndefined();
  });

  it("bridges a background launch to its dispatch only when the sub-agent is not mapped yet", () => {
    agents().recordDispatch("toolu_1", { ticket: "FRT-1", description: "Build FRT-1", session: "session-1", at: now });
    resolver().bridge("a1", "toolu_1", "session-1");
    expect(agents().readAgent("a1")).toMatchObject({ ticket: "FRT-1", toolUseId: "toolu_1" });
    agents().recordDispatch("toolu_2", { ticket: "FRT-2", description: "Build FRT-2", session: "session-1", at: now });
    resolver().bridge("a1", "toolu_2", "session-1");
    expect(agents().readAgent("a1")?.ticket).toBe("FRT-1");
    resolver().bridge("a2", "toolu_missing", "session-1");
    expect(agents().readAgent("a2")).toBeUndefined();
  });
});
