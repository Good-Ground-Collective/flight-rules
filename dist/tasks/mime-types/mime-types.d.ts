export interface MimeTypeResolver {
    forFilename(filename: string): string;
}
/**
 * Evidence uploads carry the screenshot, recording, and text formats the QA
 * lane captures; anything else is handed to Jira as opaque bytes.
 */
export declare class ExtensionMimeTypeResolver implements MimeTypeResolver {
    forFilename(filename: string): string;
}
export declare const extensionMimeTypeResolver: MimeTypeResolver;
