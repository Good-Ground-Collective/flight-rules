import { TicketKeySchema } from "./ariadne.schema.js";

/** A Jira-shaped key anywhere in free text; validated again with TicketKeySchema. */
const keyPattern = /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}(?![A-Za-z0-9_])/g;

/** "ticket FRT-1", "building FRT-1", "Ticket: FRT-1". */
const phrasePattern = /\b(?:ticket|building)\s*:?\s+([A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8})(?![A-Za-z0-9_])/gi;

const urlPattern = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Prefixes that look like Jira keys in prose but name standards and versions,
 * such as a UTF encoding, a SHA digest or an ISO date format. A dispatch that
 * names one of these is never reported as that "ticket".
 */
const notProjectKeys: ReadonlySet<string> = new Set([
  "AES",
  "CVE",
  "ES",
  "GPT",
  "HTTP",
  "ISO",
  "MD",
  "PEP",
  "RFC",
  "SHA",
  "TLS",
  "SSL",
  "UTF",
  "WCAG",
]);

/**
 * Finds the Jira ticket a sub-agent or a checkout is working on, from the
 * text Claude Code hands a hook. Keys inside URLs are ignored, and so are
 * standards that happen to look like keys.
 */
export class TicketKeyExtractor {
  /**
   * The ticket an Agent dispatch is about: a key in the description, then a
   * "ticket <KEY>" or "building <KEY>" phrase in the prompt, then the first
   * key in the prompt.
   */
  fromDispatch(description: string | undefined, prompt: string | undefined): string | undefined {
    return this.firstKey(description) ?? this.fromPrompt(prompt);
  }

  /** A "ticket <KEY>" or "building <KEY>" phrase, then the first key. */
  fromPrompt(prompt: string | undefined): string | undefined {
    if (prompt === undefined) return undefined;
    const text = this.withoutUrls(prompt);
    for (const match of text.matchAll(phrasePattern)) {
      const key = this.valid(match[1]);
      if (key !== undefined) return key;
    }
    return this.firstKey(text);
  }

  /** The first key in a description, a branch name or a directory name. */
  firstKey(text: string | undefined): string | undefined {
    if (text === undefined) return undefined;
    for (const match of this.withoutUrls(text).matchAll(keyPattern)) {
      const key = this.valid(match[0]);
      if (key !== undefined) return key;
    }
    return undefined;
  }

  private withoutUrls(text: string): string {
    return text.replace(urlPattern, " ");
  }

  private valid(candidate: string | undefined): string | undefined {
    if (candidate === undefined) return undefined;
    const parsed = TicketKeySchema.safeParse(candidate);
    if (!parsed.success) return undefined;
    const project = parsed.data.slice(0, parsed.data.indexOf("-"));
    return notProjectKeys.has(project) ? undefined : parsed.data;
  }
}
