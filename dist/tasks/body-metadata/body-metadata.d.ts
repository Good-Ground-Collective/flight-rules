import { type EntityMetadata } from '../task-tracker/task-tracker.js';
export declare class BodyMetadataService {
    parse(body: string): EntityMetadata;
    splice(body: string, patch: Partial<EntityMetadata>): string;
}
