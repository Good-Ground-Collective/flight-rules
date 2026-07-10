import { JiraClient } from './jira-client.js'
import { adfBuilder, type AdfDocNode, type AdfNode } from './adf.js'
import { JiraAdfMetadataService, type AdfMetadataService } from './adf-metadata.js'
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  EntityMetadata,
  Epic,
  Initiative,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../task-tracker/task-tracker.js'

interface JiraTrackerConfig {
  token: string
  host: string
  email: string
  project: string
  jpdProject?: string
}

interface JiraAssignableUser {
  accountId: string
  displayName: string
}

interface JiraCreatedIssue {
  id: string
  key: string
}

interface JiraIssueLink {
  id?: string
  type: { name: string }
  inwardIssue?: { key: string }
  outwardIssue?: { key: string }
}

interface JiraLinkType {
  id: string
  name: string
  inward: string
  outward: string
}

interface JiraIssueLinkTypesResponse {
  issueLinkTypes: JiraLinkType[]
}

interface JiraIssue {
  id: string
  key: string
  fields: {
    summary: string
    status?: { name: string }
    labels?: string[]
    assignee?: { accountId: string } | null
    description?: AdfDocNode | null
    updated?: string
    parent?: { key: string }
    issuelinks?: JiraIssueLink[]
  }
}

interface JiraSearchResponse {
  issues: JiraIssue[]
}

interface JiraIssueTypesResponse {
  values: { id: string; name: string }[]
}

interface JiraComment {
  id: string
  author?: { displayName?: string }
  created: string
  updated: string
}

const metadataExpandTitle = 'LLM Context'
const issueFields = 'summary,status,labels,assignee,description,issuelinks,updated'

/**
 * The Jira / Jira Product Discovery backend. Epics map to the Epic issue type
 * and tickets to Story; parentage rides the native `parent` field, and entity
 * metadata round-trips through the ADF description via {@link AdfMetadataService}.
 * Blocking dependencies ride "Blocks" issue links, resolved by name from the
 * instance, and entity metadata updates splice back through the description.
 * Initiatives and TDDs arrive in later tickets and reject until then.
 */
export class JiraTaskTracker implements TaskTracker {
  private readonly client: JiraClient
  private readonly project: string
  private readonly metadata: AdfMetadataService = new JiraAdfMetadataService()
  private issueTypeNames: string[] | undefined
  private blocksLinkType: string | undefined

  constructor(config: JiraTrackerConfig) {
    this.client = new JiraClient({ host: config.host, email: config.email, token: config.token })
    this.project = config.project
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const issuetype = await this.resolveIssueType('Epic')
    const description = this.metadata.splice(adfBuilder.doc(input.body), input.metadata ?? {})

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
    const description = this.metadata.splice(adfBuilder.doc(input.body), input.metadata ?? {})

    const created = await this.client.request<JiraCreatedIssue>('POST', '/issue', {
      fields: {
        project: { key: this.project },
        issuetype: { name: issuetype },
        summary: input.title,
        description,
        parent: { key: input.epicId },
        labels: input.labels,
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
      (link) => link.type.name === blocksLinkType && link.inwardIssue?.key === blockedById,
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
      (candidate) => candidate.type.name === blocksLinkType && candidate.inwardIssue?.key === blockedById,
    )
    if (link?.id === undefined) return

    await this.client.request('DELETE', `/issueLink/${link.id}`)
  }

  async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(epicId, patch)
  }

  async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(ticketId, patch)
  }

  updateTddMetadata(): Promise<void> {
    return this.notImplemented('updateTddMetadata')
  }

  createInitiative(): Promise<Initiative> {
    return this.notImplemented('createInitiative')
  }

  getInitiative(): Promise<Initiative> {
    return this.notImplemented('getInitiative')
  }

  linkEpicToInitiative(): Promise<void> {
    return this.notImplemented('linkEpicToInitiative')
  }

  createTechnicalDesign(): Promise<TechnicalDesign> {
    return this.notImplemented('createTechnicalDesign')
  }

  getTechnicalDesign(): Promise<TechnicalDesign> {
    return this.notImplemented('getTechnicalDesign')
  }

  async addComment(entityId: string, body: string): Promise<Comment> {
    const comment = await this.client.request<JiraComment>('POST', `/issue/${entityId}/comment`, {
      body: adfBuilder.doc(body),
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
      this.client.request<JiraSearchResponse>('GET', '/search', undefined, {
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
      if (link.inwardIssue !== undefined) blockedBy.push(link.inwardIssue.key)
      if (link.outwardIssue !== undefined) blocking.push(link.outwardIssue.key)
    })
    return { blockedBy, blocking }
  }

  private async spliceDescriptionMetadata(key: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${key}`, undefined, { fields: 'description' })
    const current = issue.fields.description ?? adfBuilder.doc('')
    const next = this.metadata.splice(current, patch)

    // No optimistic lock exists, so a concurrent description edit can be lost —
    // the same read-then-write race the GitHub tracker accepts.
    await this.client.request('PUT', `/issue/${key}`, { fields: { description: next } })
  }

  private async issueLinks(ticketId: string): Promise<JiraIssueLink[]> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${ticketId}`, undefined, {
      fields: 'issuelinks',
    })
    return issue.fields.issuelinks ?? []
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

  private parseMetadata(issue: JiraIssue) {
    const description = issue.fields.description
    return description === null || description === undefined ? {} : this.metadata.parse(description)
  }

  private extractBody(description: AdfDocNode | null | undefined): string {
    if (description === null || description === undefined) return ''
    return description.content
      .filter((node) => !this.isMetadataNode(node))
      .map((node) => this.nodeText(node))
      .filter((text) => text.length > 0)
      .join('\n')
  }

  private isMetadataNode(node: AdfNode): boolean {
    return node.type === 'expand' && node.attrs?.['title'] === metadataExpandTitle
  }

  private nodeText(node: AdfNode): string {
    if (node.text !== undefined) return node.text
    return (node.content ?? []).map((child) => this.nodeText(child)).join('')
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
      this.issueTypeNames = meta.values.map((type) => type.name)
    }
    return this.issueTypeNames
  }

  private notImplemented(method: string): Promise<never> {
    return Promise.reject(new Error(`JiraTaskTracker.${method} not implemented`))
  }
}
