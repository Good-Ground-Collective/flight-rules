import { z } from 'zod';
import type { Attachment, TaskTracker } from '../task-tracker/task-tracker.js';
/**
 * `<path>#<caption>`, where the caption is used only when the file is appended
 * (an in-body reference keeps its own alt text). `#` is legal in a filename, so
 * a leading or absent `#` means the whole spec is the path and the caption falls
 * back to the basename.
 */
export declare const AttachmentSpecSchema: z.ZodPipe<z.ZodString, z.ZodTransform<{
    path: string;
    caption: string;
}, string>>;
export type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
export interface EvidenceRequest {
    ticketId: string;
    body: string;
    specs: readonly string[];
}
export interface EvidenceAttachment extends Attachment {
    path: string;
    caption: string;
    referenced: boolean;
}
export interface AttachedEvidence {
    body: string;
    attachments: EvidenceAttachment[];
}
export interface EvidenceService {
    attach(input: EvidenceRequest): Promise<AttachedEvidence>;
}
export interface DuplicateEvidenceNameProps {
    filename: string;
    paths: readonly string[];
}
/** Two specs whose files share a basename would collide on the same `attachment:<filename>` marker, so the rewrite could not tell them apart. */
export declare class DuplicateEvidenceNameError extends Error {
    name: string;
    constructor(props: DuplicateEvidenceNameProps);
}
export interface TrackerEvidenceServiceProps {
    tracker: TaskTracker;
}
/**
 * Uploads every `--attach` spec, then rewrites the body's local `![alt](./file)`
 * and `[text](./file)` references to `attachment:<filename>` and appends any
 * unreferenced file. Uploads finish before the body is rewritten, so a body
 * never ships with a marker for a file that failed to upload — unlike gh's
 * partial-post behaviour, which the PR host keeps because gh owns its own rewrite.
 */
export declare class TrackerEvidenceService implements EvidenceService {
    private readonly tracker;
    constructor(props: TrackerEvidenceServiceProps);
    attach(input: EvidenceRequest): Promise<AttachedEvidence>;
    private rejectDuplicateNames;
    private rewriteReferences;
    /**
     * A line opens a fence when it is a run of >=3 backticks or tildes; a backtick
     * fence's info string may not itself contain a backtick, which keeps inline
     * code from being read as a fence.
     */
    private openingFence;
    /**
     * A line closes an open fence only when it is a run of the SAME character, at
     * least as long as the opening run, with nothing but whitespace after it.
     */
    private closesFence;
    private rewriteLine;
    private resolve;
    private appendUnreferenced;
}
