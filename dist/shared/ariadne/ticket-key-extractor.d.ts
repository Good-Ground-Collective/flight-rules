/**
 * Finds the Jira ticket a sub-agent or a checkout is working on, from the
 * text Claude Code hands a hook. Keys inside URLs are ignored, and so are
 * standards that happen to look like keys.
 */
export declare class TicketKeyExtractor {
    /**
     * The ticket an Agent dispatch is about: a key in the description, then a
     * "ticket <KEY>" or "building <KEY>" phrase in the prompt, then the first
     * key in the prompt.
     */
    fromDispatch(description: string | undefined, prompt: string | undefined): string | undefined;
    /** A "ticket <KEY>" or "building <KEY>" phrase, then the first key. */
    fromPrompt(prompt: string | undefined): string | undefined;
    /** The first key in a description, a branch name or a directory name. */
    firstKey(text: string | undefined): string | undefined;
    private withoutUrls;
    private valid;
}
