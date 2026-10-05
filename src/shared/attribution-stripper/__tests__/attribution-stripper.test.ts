import { describe, expect, it } from "vitest";
import { AttributionStripper } from "../attribution-stripper.js";

const stripper = new AttributionStripper();

describe("AttributionStripper.strip", () => {
  it("removes Co-Authored-By Claude and Claude-Session trailers", () => {
    const message = [
      "feat(x): add y",
      "",
      "Body paragraph.",
      "",
      "Refs: FRT-1",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "Claude-Session: https://claude.ai/code/session_014C94M4eKGUvY3HY8spwjo9",
    ].join("\n");
    expect(stripper.strip(message)).toBe("feat(x): add y\n\nBody paragraph.\n\nRefs: FRT-1");
  });

  it("removes a bare session link line from a PR body", () => {
    const body = "Summary.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_abc_123\n";
    expect(stripper.strip(body)).toBe("Summary.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n");
  });

  it("is case-insensitive on the trailer key", () => {
    expect(stripper.strip("x\n\nco-authored-by: Claude <noreply@anthropic.com>\n")).toBe("x\n\n");
  });

  it("keeps human co-authors and prose that mentions Claude", () => {
    const text = "Pairing with Claude on this.\n\nCo-Authored-By: Jane Doe <jane@acme.com>\n";
    expect(stripper.strip(text)).toBe(text);
  });

  it("leaves an inline session link inside a sentence", () => {
    const text = "See https://claude.ai/code/session_abc for the transcript.\n";
    expect(stripper.strip(text)).toBe(text);
  });
});

describe("AttributionStripper.stripCommand", () => {
  it("rewrites a heredoc git commit", () => {
    const command = `git commit -F - <<'EOF'\nfix: y\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF`;
    expect(stripper.stripCommand(command)).toBe("git commit -F - <<'EOF'\nfix: y\n\nEOF");
  });

  it.each([
    'gh pr create --body "x\nClaude-Session: https://claude.ai/code/session_a"',
    'gh pr edit 3 --body "x\nhttps://claude.ai/code/session_a"',
    'git add a && git commit -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
  ])("rewrites %s", (command) => {
    expect(stripper.stripCommand(command)).toBeDefined();
  });

  it("keeps the closing quote of a quoted body", () => {
    expect(stripper.stripCommand('gh pr edit 3 --body "x\nhttps://claude.ai/code/session_a"')).toBe('gh pr edit 3 --body "x"');
  });

  it("recognises a single attribution line", () => {
    expect(stripper.isAttribution("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")).toBe(true);
    expect(stripper.isAttribution("Claude-Session: https://claude.ai/code/session_x")).toBe(true);
    expect(stripper.isAttribution("Refs: FRT-1")).toBe(false);
    expect(stripper.isAttribution("Co-Authored-By: Jane <jane@acme.com>")).toBe(false);
  });

  it("returns undefined for commands that write no message", () => {
    expect(stripper.stripCommand('echo "Co-Authored-By: Claude <noreply@anthropic.com>" >> NOTES.md')).toBeUndefined();
    expect(stripper.stripCommand('cat > msg.txt <<EOF\nCo-Authored-By: Claude <x@anthropic.com>\nEOF')).toBeUndefined();
  });

  it("returns undefined when a commit carries no attribution", () => {
    expect(stripper.stripCommand('git commit -m "fix: y"')).toBeUndefined();
  });
});
