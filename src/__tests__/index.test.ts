import { describe, expect, it } from 'vitest'
import { createFlightRules, DefaultFlightRules, NodeGitExecutor, nodeToolProbe } from '../index.js'

describe('public library surface', () => {
  it('exports exactly the supported values', async () => {
    expect(Object.keys(await import('../index.js')).sort()).toEqual([
      'AgentCapabilitySchema',
      'AgentFrontmatterSchema',
      'AttachmentSchema',
      'AttachmentSpecSchema',
      'BlobSectionSource',
      'BodyMetadataService',
      'BodySectionSelector',
      'CommentSchema',
      'CommitMessageInputSchema',
      'ConfigSchema',
      'CreateEpicInputSchema',
      'CreateInitiativeInputSchema',
      'CreateTechnicalDesignInputSchema',
      'CreateTicketInputSchema',
      'DefaultCommitMessageBuilder',
      'DefaultFlightRules',
      'DefaultPullRequestBuilder',
      'DependencyPlannerService',
      'DocIdSchema',
      'DuplicateEvidenceNameError',
      'EntityMetadataSchema',
      'EnvLoader',
      'EpicSchema',
      'FileDocResolver',
      'GhOutputParseError',
      'GhPullRequestHost',
      'GitHubTaskTracker',
      'InitiativeSchema',
      'JiraTaskTracker',
      'LayeredBodyAdfConverter',
      'MediaLookupSchema',
      'MediaRefSchema',
      'ModelTierSchema',
      'NodeGitExecutor',
      'NodeToolProbe',
      'PrecedenceBodyFormatDetector',
      'PullRequestTemplateSchema',
      'PushSpecSchema',
      'SemanticTypeSchema',
      'TechnicalDesignSchema',
      'TicketSchema',
      'TrackerEvidenceService',
      'TrackerUserSchema',
      'UnsupportedTrackerOperationError',
      'UpdateEpicInputSchema',
      'UpdateInitiativeInputSchema',
      'UpdateTicketInputSchema',
      'YamlAgentFrontmatterParser',
      'agentCapabilities',
      'agentFrontmatterParser',
      'appVersion',
      'blobSectionSource',
      'bodyFormatDetector',
      'createFlightRules',
      'getQaRecipePath',
      'getRfcDir',
      'markdownAdfConverter',
      'modelTiers',
      'nodeToolProbe',
      'pullRequestBuilder',
      'readConfig',
      'resolveConfigPath',
      'sectionSelector',
      'seedCompetencies',
      'semanticTypes',
    ].sort())
  })

  it('constructs a working core without requiring configuration or credentials', () => {
    const core = createFlightRules({ cwd: '/nonexistent', env: {} })
    expect(core).toBeInstanceOf(DefaultFlightRules)
    expect(core.git()).toBeInstanceOf(NodeGitExecutor)
    expect(core.probe()).toBe(nodeToolProbe)
  })
})
