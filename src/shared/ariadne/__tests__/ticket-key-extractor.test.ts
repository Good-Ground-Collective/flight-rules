import { describe, expect, it } from "vitest";
import { TicketKeyExtractor } from "../ticket-key-extractor.js";

describe("TicketKeyExtractor", () => {
  const extractor = new TicketKeyExtractor();

  describe("fromDispatch precedence", () => {
    it("prefers a key in the description over anything in the prompt", () => {
      expect(extractor.fromDispatch("Build FRT-1234 probe", "You are building ticket PD-9. See FRT-1.")).toBe("FRT-1234");
    });

    it("then a 'ticket <KEY>' or 'building <KEY>' phrase in the prompt, over an earlier key", () => {
      expect(extractor.fromDispatch("Build the API", "Read FRT-1 for context. You are building ticket PD-302.")).toBe("PD-302");
      expect(extractor.fromDispatch("Build the API", "Depends on FRT-1. Building FRT-2835 now.")).toBe("FRT-2835");
      expect(extractor.fromDispatch(undefined, "See FRT-1. Ticket: PD-7")).toBe("PD-7");
    });

    it("then the first key in the prompt", () => {
      expect(extractor.fromDispatch("Build the API", "Implement FRT-12 and then FRT-13.")).toBe("FRT-12");
    });

    it("returns undefined when neither names a ticket", () => {
      expect(extractor.fromDispatch("Explore the repo", "Find the config loader.")).toBeUndefined();
      expect(extractor.fromDispatch(undefined, undefined)).toBeUndefined();
    });
  });

  it("ignores keys inside URLs", () => {
    expect(extractor.firstKey("See https://example.atlassian.net/browse/FRT-1 then FRT-2")).toBe("FRT-2");
    expect(extractor.fromPrompt("Read https://jira.example.com/browse/FRT-1?x=1")).toBeUndefined();
  });

  it("ignores standards and versions that look like keys", () => {
    expect(extractor.firstKey("Encode as UTF-8, hash with SHA-256, date as ISO-8601, then FRT-5")).toBe("FRT-5");
  });

  it("does not match lower-case, zero-numbered or embedded keys", () => {
    expect(extractor.firstKey("frt-12 FRT-0 XFRT-12a")).toBeUndefined();
  });

  it("finds a key in a branch or directory name", () => {
    expect(extractor.firstKey("feat/FRT-77-search")).toBe("FRT-77");
    expect(extractor.firstKey("FRT-42-login")).toBe("FRT-42");
    expect(extractor.firstKey("ariadne-agent-hook")).toBeUndefined();
  });

  it("finds a key after a hyphenated clone name, but not inside an upper-case chain", () => {
    expect(extractor.firstKey("crime-linking-aws-FRT-2835")).toBe("FRT-2835");
    expect(extractor.firstKey("ABC-DEF-12")).toBeUndefined();
  });
});
