import { type EntityMetadata } from '../task-tracker/task-tracker.js';
import { type AdfDocNode } from './adf.js';
export interface AdfMetadataService {
    parse(doc: AdfDocNode): EntityMetadata;
    splice(doc: AdfDocNode, patch: Partial<EntityMetadata>): AdfDocNode;
}
export declare class JiraAdfMetadataService implements AdfMetadataService {
    parse(doc: AdfDocNode): EntityMetadata;
    splice(doc: AdfDocNode, patch: Partial<EntityMetadata>): AdfDocNode;
    private readMetadataYaml;
    private isMetadataExpand;
}
export declare const jiraAdfMetadataService: AdfMetadataService;
