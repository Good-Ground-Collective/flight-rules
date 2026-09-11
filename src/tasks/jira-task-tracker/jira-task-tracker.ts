import { JiraClient } from './jira-client.js'
import { ConfluenceClient } from './confluence-client.js'
import type { AdfDocNode, AdfNode } from './adf.js'
import { markdownAdfConverter, type MarkdownAdfConverter } from './markdown-adf.js'
import { JiraAdfMetadataService, type AdfMetadataService } from './adf-metadata.js'
import type {
  JiraAssignableUser,
  JiraComment,
  JiraCreatedIssue,
  JiraIssue,
  JiraIssueLink,
  JiraIssueLinkTypesResponse,
  JiraTransitionsResponse,
  JiraIssueTypesResponse,
  JiraProject,
  JiraSearchResponse,
  JiraTrackerConfig,
} from './jira-interfaces.js'
import type {
  ConfluencePage,
  ConfluencePropertiesResponse,
  ConfluenceProperty,
  ConfluenceSpacesResponse,
} from './confluence-interfaces.js'
import { EntityMetadataSchema } from '../task-tracker/task-tracker.js'
import type {
  Comment,
  CreateEpicInput,
  CreateInitiativeInput,
  CreateTechnicalDesignInput,
  CreateTicketInput,
  EntityMetadata,
  Epic,
  Initiative,
  TaskTracker,
  TechnicalDesign,
  Ticket,
  UpdateEpicInput,
  UpdateInitiativeInput,
  UpdateTicketInput,
} from '../task-tracker/task-tracker.js'

const metadataExpandTitle = 'LLM Context'
const issueFields = 'summary,status,labels,assignee,description,issuelinks,updated'
const ideaIssueType = 'Idea'
const jpdProjectType = 'product_discovery'
const deliveryLinkOutward = 'implements'
const tddMetadataPropertyKey = 'flight-rules-metadata'

/**
 * The Jira / Jira Product Discovery backend. Epics map to the Epic issue type
 * and tickets to Story; parentage rides the native `parent` field, and entity
 * metadata round-trips through the ADF description via {@link AdfMetadataService}.
 * Blocking dependencies ride "Blocks" issue links, resolved by name from the
 * instance, and entity metadata updates splice back through the description.
 * Initiatives map to JPD Ideas in the configured discovery project, linked to
 * delivery epics via the "Polaris issue link" type. Technical designs are
 * Confluence pages in the configured space, their metadata held in a native
 * content property and their URL stamped onto the parent epic.
 */
export class JiraTaskTracker implements TaskTracker {
  private readonly client: JiraClient
  private readonly confluence: ConfluenceClient
  private readonly project: string
  private readonly jpdProject: string | undefined
  private readonly confluenceSpaceKey: string | undefined
  private readonly metadata: AdfMetadataService = new JiraAdfMetadataService()
  private readonly bodyFormat: MarkdownAdfConverter = markdownAdfConverter
  private issueTypeNames: string[] | undefined
  private blocksLinkType: string | undefined
  private deliveryLinkType: string | undefined
  private confluenceSpaceId: string | undefined
  private jpdProjectVerified = false

  constructor(config: JiraTrackerConfig) {
    this.client = new JiraClient({ host: config.host, email: config.email, token: config.token })
    this.confluence = new ConfluenceClient({ host: config.host, email: config.email, token: config.token })
    this.project = config.project
    this.jpdProject = config.jpdProject
    this.confluenceSpaceKey = config.confluenceSpaceKey
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const issuetype = await this.resolveIssueType('Epic')
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), input.metadata ?? {})

    const created = await this.client.request<JiraCreatedIssue>('POST', '/issue', {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        labels: input.labels,
      },
    })

    return this.getEpic(created.key)
  }

  async getEpic(id: string): Promise<Epic> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${id}`, undefined, { fields: issueFields })
    const childIssues = await this.searchChildren(issue.key)

    return {
      id: issue.key,
      size: 'epic',
      status: issue.fields.status?.name ?? 'unknown',
      labels: issue.fields.labels ?? [],
      title: issue.fields.summary,
      body: this.extractBody(issue.fields.description),
      childIssues,
      comments: [],
      metadata: this.parseMetadata(issue),
      updatedAt: issue.fields.updated ?? '',
    }
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const issuetype = await this.resolveIssueType('Story')
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), input.metadata ?? {})

    const created = await this.client.request<JiraCreatedIssue>('POST', '/issue', {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        labels: input.labels,
        ...(input.epicId !== undefined ? { parent: { key: input.epicId } } : {}),
        ...(input.assignee !== undefined ? { assignee: { accountId: input.assignee } } : {}),
      },
    })

    return this.getTicket(created.key)
  }

  async getTicket(id: string): Promise<Ticket> {
    const [issue, blocksLinkType] = await Promise.all([
      this.client.request<JiraIssue>('GET', `/issue/${id}`, undefined, { fields: issueFields }),
      this.resolveBlocksLinkType(),
    ])
    return this.mapTicket(issue, blocksLinkType)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${ticketId}`, undefined, { fields: 'parent' })
    if (issue.fields.parent?.key === epicId) return

    await this.client.request('PUT', `/issue/${ticketId}`, { fields: { parent: { key: epicId } } })
  }

  async blockTicket(ticketId: string, blockedById: string): Promise<void> {
    if (ticketId === blockedById) throw new Error('a ticket cannot block itself')

    const blocksLinkType = await this.resolveBlocksLinkType()
    const links = await this.issueLinks(ticketId)
    const alreadyBlocked = links.some(
      (link) => link.type.name === blocksLinkType && link.outwardIssue?.key === blockedById,
    )
    if (alreadyBlocked) return

    await this.client.request('POST', '/issueLink', {
      type: { name: blocksLinkType },
      inwardIssue: { key: ticketId },
      outwardIssue: { key: blockedById },
    })
  }

  async unblockTicket(ticketId: string, blockedById: string): Promise<void> {
    const blocksLinkType = await this.resolveBlocksLinkType()
    const links = await this.issueLinks(ticketId)
    const link = links.find(
      (candidate) => candidate.type.name === blocksLinkType && candidate.outwardIssue?.key === blockedById,
    )
    if (link?.id === undefined) return

    await this.client.request('DELETE', `/issueLink/${link.id}`)
  }

  async transitionTicket(ticketId: string, status: string): Promise<void> {
    const response = await this.fetchTransitions(ticketId)
    const match = response.transitions.find((transition) => transition.to.name.toLowerCase() === status.toLowerCase())
    if (match === undefined) {
      const available = response.transitions.map((transition) => transition.to.name).join(', ')
      throw new Error(
        `No transition to status "${status}" is available for ${ticketId} from its current status (available: ${available})`,
      )
    }
    await this.client.request('POST', `/issue/${ticketId}/transitions`, { transition: { id: match.id } })
  }

  async listTransitions(ticketId: string): Promise<string[]> {
    const response = await this.fetchTransitions(ticketId)
    return response.transitions.map((transition) => transition.to.name)
  }

  /**
   * Jira's `add`/`remove` label verbs are set operations, so the write is
   * atomic against whatever labels the issue already has — no read first.
   */
  async addLabel(ticketId: string, label: string): Promise<void> {
    await this.client.request('PUT', `/issue/${ticketId}`, { update: { labels: [{ add: label }] } })
  }

  async removeLabel(ticketId: string, label: string): Promise<void> {
    await this.client.request('PUT', `/issue/${ticketId}`, { update: { labels: [{ remove: label }] } })
  }

  async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(epicId, patch)
  }

  async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(ticketId, patch)
  }

  async updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const existing = await this.tddMetadataProperty(tddId)
    const merged: Record<string, unknown> = { ...(existing?.value ?? {}) }
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined) merged[key] = value
    })

    if (existing === undefined) {
      await this.confluence.request('POST', `/pages/${tddId}/properties`, {
        key: tddMetadataPropertyKey,
        value: merged,
      })
      return
    }

    await this.confluence.request('PUT', `/pages/${tddId}/properties/${existing.id}`, {
      key: tddMetadataPropertyKey,
      value: merged,
      version: { number: (existing.version?.number ?? 1) + 1 },
    })
  }

  async updateEpicDescription(epicId: string, input: UpdateEpicInput): Promise<Epic> {
    await this.replaceIssueBody(epicId, input)
    return this.getEpic(epicId)
  }

  async updateTicketDescription(ticketId: string, input: UpdateTicketInput): Promise<Ticket> {
    await this.replaceIssueBody(ticketId, input)
    return this.getTicket(ticketId)
  }

  async updateInitiativeDescription(initiativeId: string, input: UpdateInitiativeInput): Promise<Initiative> {
    // Initiatives (JPD Ideas) carry no entity-metadata block, so the body is
    // written straight through without a metadata re-merge.
    const fields: Record<string, unknown> = { description: this.bodyFormat.toAdf(input.body) }
    if (input.title !== undefined) fields['summary'] = input.title
    await this.client.request('PUT', `/issue/${initiativeId}`, { fields })
    return this.getInitiative(initiativeId)
  }

  async createInitiative(input: CreateInitiativeInput): Promise<Initiative> {
    const projectKey = await this.ensureJpdProject()

    const created = await this.client.request<JiraCreatedIssue>('POST', '/issue', {
      fields: {
        project: { key: projectKey },
        issuetype: { name: ideaIssueType },
        summary: input.title,
        description: this.bodyFormat.toAdf(input.body),
      },
    })

    return this.getInitiative(created.key)
  }

  async getInitiative(id: string): Promise<Initiative> {
    const idea = await this.client.request<JiraIssue>('GET', `/issue/${id}`, undefined, {
      fields: 'summary,description,issuelinks',
    })
    const deliveryLinkType = await this.resolveDeliveryLinkType()
    const epicKeys = this.deliveryLinkedKeys(idea.fields.issuelinks ?? [], deliveryLinkType)
    const epics = await Promise.all(
      epicKeys.map(async (key) => {
        const epic = await this.client.request<JiraIssue>('GET', `/issue/${key}`, undefined, { fields: 'summary' })
        return { id: epic.key, title: epic.fields.summary }
      }),
    )

    return {
      id: idea.key,
      size: 'initiative',
      title: idea.fields.summary,
      body: this.extractBody(idea.fields.description),
      epics,
    }
  }

  async linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void> {
    const deliveryLinkType = await this.resolveDeliveryLinkType()
    const links = await this.issueLinks(initiativeId)
    const alreadyLinked = links.some(
      (link) =>
        link.type.name === deliveryLinkType &&
        (link.outwardIssue?.key === epicId || link.inwardIssue?.key === epicId),
    )
    if (alreadyLinked) return

    // Idea outward, epic inward: the reverse still creates the link, but JPD's Delivery rollup will not surface it.
    await this.client.request('POST', '/issueLink', {
      type: { name: deliveryLinkType },
      outwardIssue: { key: initiativeId },
      inwardIssue: { key: epicId },
    })
  }

  async createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign> {
    const spaceId = await this.resolveConfluenceSpaceId()
    // Jira epic ids are keys (e.g. "PROJ-1"), not numbers, so the epic key is
    // stored as a string alongside the entity metadata rather than in the
    // numeric `epicId` metadata field.
    const propertyValue: Record<string, unknown> = { ...input.metadata, epicId: input.epicId }

    const page = await this.confluence.request<ConfluencePage>('POST', '/pages', {
      spaceId,
      status: 'current',
      title: input.title,
      body: { representation: 'storage', value: input.body },
    })

    await this.confluence.request('POST', `/pages/${page.id}/properties`, {
      key: tddMetadataPropertyKey,
      value: propertyValue,
    })
    await this.updateEpicMetadata(input.epicId, { tddId: Number(page.id) })

    return this.mapTechnicalDesign(page, input.body, propertyValue)
  }

  async getTechnicalDesign(id: string): Promise<TechnicalDesign> {
    const [page, property] = await Promise.all([
      this.confluence.request<ConfluencePage>('GET', `/pages/${id}`, undefined, { 'body-format': 'storage' }),
      this.tddMetadataProperty(id),
    ])
    return this.mapTechnicalDesign(page, page.body?.storage?.value ?? '', property?.value ?? {})
  }

  async addComment(entityId: string, body: string): Promise<Comment> {
    const comment = await this.client.request<JiraComment>('POST', `/issue/${entityId}/comment`, {
      body: this.bodyFormat.toAdf(body),
    })
    return {
      id: comment.id,
      body,
      author: comment.author?.displayName ?? '',
      createdAt: comment.created,
      updatedAt: comment.updated,
    }
  }

  async getUsers(): Promise<string[]> {
    const users = await this.client.request<JiraAssignableUser[]>('GET', '/user/assignable/search', undefined, {
      project: this.project,
      maxResults: 100,
    })
    return users.map((user) => user.displayName)
  }

  async ping(): Promise<void> {
    await this.client.request('GET', '/myself')
  }

  private async searchChildren(epicKey: string): Promise<Ticket[]> {
    const [page, blocksLinkType] = await Promise.all([
      this.client.request<JiraSearchResponse>('GET', '/search/jql', undefined, {
        jql: `parent = ${epicKey}`,
        fields: issueFields,
        maxResults: 100,
      }),
      this.resolveBlocksLinkType(),
    ])
    return page.issues.map((issue) => this.mapTicket(issue, blocksLinkType))
  }

  private mapTicket(issue: JiraIssue, blocksLinkType: string): Ticket {
    const { blockedBy, blocking } = this.blockingLinks(issue.fields.issuelinks ?? [], blocksLinkType)
    return {
      id: issue.key,
      size: 'ticket',
      status: issue.fields.status?.name ?? 'unknown',
      labels: issue.fields.labels ?? [],
      title: issue.fields.summary,
      body: this.extractBody(issue.fields.description),
      comments: [],
      assignee: issue.fields.assignee?.accountId ?? null,
      blockedBy,
      blocking,
      metadata: this.parseMetadata(issue),
      updatedAt: issue.fields.updated ?? '',
    }
  }

  private blockingLinks(
    links: JiraIssueLink[],
    blocksLinkType: string,
  ): { blockedBy: string[]; blocking: string[] } {
    const blockedBy: string[] = []
    const blocking: string[] = []
    links.forEach((link) => {
      if (link.type.name !== blocksLinkType) return
      // Jira reports the partner in the partner's own slot, so outward is what blocks this issue and inward is what it blocks.
      if (link.outwardIssue !== undefined) blockedBy.push(link.outwardIssue.key)
      if (link.inwardIssue !== undefined) blocking.push(link.inwardIssue.key)
    })
    return { blockedBy, blocking }
  }

  private async replaceIssueBody(
    key: string,
    input: { body: string; title?: string | undefined; labels?: string[] | undefined },
  ): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${key}`, undefined, { fields: 'description' })
    // Preserve the entity-metadata block: rebuild the description from the new
    // body, then splice the metadata carried on the existing description back in
    // (an edited body, read back via `get`, never carries it), so the same
    // markdown→ADF path as create runs without clobbering the LLM Context expand.
    const description = this.metadata.splice(this.bodyFormat.toAdf(input.body), this.parseMetadata(issue))
    const fields: Record<string, unknown> = { description }
    if (input.title !== undefined) fields['summary'] = input.title
    if (input.labels !== undefined) fields['labels'] = input.labels
    await this.client.request('PUT', `/issue/${key}`, { fields })
  }

  private async spliceDescriptionMetadata(key: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${key}`, undefined, { fields: 'description' })
    const current = issue.fields.description ?? this.bodyFormat.toAdf('')
    const next = this.metadata.splice(current, patch)
    await this.client.request('PUT', `/issue/${key}`, { fields: { description: next } })
  }

  private deliveryLinkedKeys(links: JiraIssueLink[], deliveryLinkType: string): string[] {
    const keys: string[] = []
    links.forEach((link) => {
      if (link.type.name !== deliveryLinkType) return
      const key = link.outwardIssue?.key ?? link.inwardIssue?.key
      if (key !== undefined) keys.push(key)
    })
    return keys
  }

  private async ensureJpdProject(): Promise<string> {
    if (this.jpdProject === undefined) {
      throw new Error('No JPD project is configured; set jpdProject to create or link initiatives')
    }
    if (!this.jpdProjectVerified) {
      const project = await this.client.request<JiraProject>('GET', `/project/${this.jpdProject}`)
      if (project.projectTypeKey !== jpdProjectType) {
        throw new Error(
          `Project ${this.jpdProject} is a "${project.projectTypeKey}" project, not a ${jpdProjectType} (JPD) project`,
        )
      }
      this.jpdProjectVerified = true
    }
    return this.jpdProject
  }

  private async issueLinks(ticketId: string): Promise<JiraIssueLink[]> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${ticketId}`, undefined, {
      fields: 'issuelinks',
    })
    return issue.fields.issuelinks ?? []
  }

  private async fetchTransitions(ticketId: string): Promise<JiraTransitionsResponse> {
    // Resolved per call, not cached: only transitions reachable from the issue's current status are returned.
    return this.client.request<JiraTransitionsResponse>('GET', `/issue/${ticketId}/transitions`)
  }

  private async resolveBlocksLinkType(): Promise<string> {
    if (this.blocksLinkType === undefined) {
      const response = await this.client.request<JiraIssueLinkTypesResponse>('GET', '/issueLinkType')
      const match = response.issueLinkTypes.find((type) => type.name.toLowerCase() === 'blocks')
      if (match === undefined) {
        const names = response.issueLinkTypes.map((type) => type.name).join(', ')
        throw new Error(`No "Blocks" issue link type is configured in this Jira instance (found: ${names})`)
      }
      this.blocksLinkType = match.name
    }
    return this.blocksLinkType
  }

  private async resolveDeliveryLinkType(): Promise<string> {
    if (this.deliveryLinkType === undefined) {
      const response = await this.client.request<JiraIssueLinkTypesResponse>('GET', '/issueLinkType')
      const match = response.issueLinkTypes.find((type) => type.outward.toLowerCase() === deliveryLinkOutward)
      if (match === undefined) {
        const names = response.issueLinkTypes.map((type) => type.name).join(', ')
        throw new Error(
          `No JPD delivery link type (outward "${deliveryLinkOutward}") is available in this Jira instance (found: ${names})`,
        )
      }
      this.deliveryLinkType = match.name
    }
    return this.deliveryLinkType
  }

  private parseMetadata(issue: JiraIssue) {
    const description = issue.fields.description
    return description === null || description === undefined ? {} : this.metadata.parse(description)
  }

  private extractBody(description: AdfDocNode | null | undefined): string {
    if (description === null || description === undefined) return ''
    return this.bodyFormat.toMarkdown(description.content.filter((node) => !this.isMetadataNode(node)))
  }

  private isMetadataNode(node: AdfNode): boolean {
    return node.type === 'expand' && node.attrs?.['title'] === metadataExpandTitle
  }

  private async resolveIssueType(name: string): Promise<string> {
    const available = await this.availableIssueTypes()
    const match = available.find((type) => type.toLowerCase() === name.toLowerCase())
    if (match === undefined) {
      throw new Error(
        `Issue type "${name}" is not available in project ${this.project} (found: ${available.join(', ')})`,
      )
    }
    return match
  }

  private async availableIssueTypes(): Promise<string[]> {
    if (this.issueTypeNames === undefined) {
      const meta = await this.client.request<JiraIssueTypesResponse>(
        'GET',
        `/issue/createmeta/${this.project}/issuetypes`,
      )
      this.issueTypeNames = meta.issueTypes.map((type) => type.name)
    }
    return this.issueTypeNames
  }

  private async resolveConfluenceSpaceId(): Promise<string> {
    if (this.confluenceSpaceKey === undefined) {
      throw new Error('No Confluence space is configured; set confluenceSpaceKey to create or fetch technical designs')
    }
    if (this.confluenceSpaceId === undefined) {
      const response = await this.confluence.request<ConfluenceSpacesResponse>('GET', '/spaces', undefined, {
        keys: this.confluenceSpaceKey,
      })
      const space = response.results[0]
      if (space === undefined) throw new Error(`Confluence space "${this.confluenceSpaceKey}" was not found`)
      this.confluenceSpaceId = space.id
    }
    return this.confluenceSpaceId
  }

  private async tddMetadataProperty(pageId: string): Promise<ConfluenceProperty | undefined> {
    const response = await this.confluence.request<ConfluencePropertiesResponse>(
      'GET',
      `/pages/${pageId}/properties`,
    )
    return response.results.find((property) => property.key === tddMetadataPropertyKey)
  }

  private mapTechnicalDesign(
    page: ConfluencePage,
    body: string,
    propertyValue: Record<string, unknown>,
  ): TechnicalDesign {
    const { epicId: rawEpicId, ...rest } = propertyValue
    const metadata = EntityMetadataSchema.parse(rest)
    const epicId = typeof rawEpicId === 'string' ? rawEpicId : rawEpicId !== undefined ? String(rawEpicId) : ''
    const webui = page._links?.webui
    return {
      id: String(page.id),
      epicId,
      ...(webui !== undefined ? { url: `${this.confluence.siteBaseUrl}${webui}` } : {}),
      body,
      comments: [],
      metadata,
      updatedAt: page.version?.createdAt ?? '',
    }
  }
}
