import { CommitMessageInputSchema, type CommitMessageBuilderProps, type CommitMessageInput } from './commit-message.schema.js';
export { CommitMessageInputSchema };
export interface CommitMessageBuilder {
    build(input: CommitMessageInput): string;
}
export declare class DefaultCommitMessageBuilder implements CommitMessageBuilder {
    private readonly pluginVersion;
    private readonly harnessVersion;
    constructor(props: CommitMessageBuilderProps);
    build(input: CommitMessageInput): string;
    private static readPluginVersion;
    private static parseHarnessVersion;
}
