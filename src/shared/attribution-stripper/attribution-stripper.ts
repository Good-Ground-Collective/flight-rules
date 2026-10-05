const trailerText = String.raw`(?:Co-Authored-By:[^\n"']*(?:Claude|anthropic\.com)[^\n"']*|Claude-Session:[^\n"']*|https://claude\.ai/code/session_[A-Za-z0-9_-]+)`;
const lineEnd = String.raw`(?=["']?[ \t]*(?:\r?\n|$))`;

/**
 * A block of trailers that ends a quoted argument or the whole text, taken
 * with the blank lines before it so no dangling paragraph break is left.
 */
const closingBlock = new RegExp(
  String.raw`(?:\r?\n[ \t]*)+${trailerText}(?:\r?\n[ \t]*${trailerText})*(?=["'](?:\s|$)|$)`,
  "gi",
);

/**
 * Any other trailer line, taken with the line break before it. Each trailer
 * must fill its line up to an optional closing quote, so a mention of Claude
 * inside a sentence is never touched and a quoted `-m "…"` or `--body "…"`
 * keeps its closing quote.
 */
const attributionLine = new RegExp(String.raw`(?:^|\r?\n)[ \t]*${trailerText}${lineEnd}`, "gi");

/** Commands whose text carries a commit message or a PR body. */
const messageCommand =
  /(^|[\s;&|(])(?:git\b[^\n;&|]*\bcommit\b|gh\s+pr\s+(?:create|edit)\b|flight-rules\s+(?:git\s+commit|pr\s+create)\b)/;

/**
 * Removes the attribution trailers Claude Code appends to commits and PR
 * bodies: `Co-Authored-By: Claude …`, `Claude-Session: …`, and a bare
 * claude.ai session link on its own line.
 */
export class AttributionStripper {
  strip(text: string): string {
    const stripped = text.replace(closingBlock, "").replace(attributionLine, "");
    if (stripped === text) return text;
    return stripped.replace(/\n{3,}/g, "\n\n");
  }

  /** The command with attribution removed, or undefined when it writes no message or carries none. */
  stripCommand(command: string): string | undefined {
    if (!messageCommand.test(command)) return undefined;
    const stripped = this.strip(command);
    return stripped === command ? undefined : stripped;
  }

  /** True when a single trailer line, such as one `--footer` value, is Claude attribution. */
  isAttribution(line: string): boolean {
    return this.strip(`\n${line.trim()}`) === "";
  }
}
