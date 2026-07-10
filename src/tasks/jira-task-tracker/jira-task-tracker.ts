import { JiraClient } from './jira-client.js'
import { adfBuilder, type AdfDocNode, type AdfNode } from './adf.js'
import { JiraAdfMetadataService, type AdfMetadataService } from './adf-metadata.js'
import type {
  JiraAssignableUser,
  JiraComment,
  JiraCreatedIssue,
  JiraIssue,
  JiraIssueLink,
  JiraIssueLinkTypesResponse,
  JiraIssueTypesResponse,
  JiraProject,
  JiraSearchResponse,
  JiraTrackerConfig,
} from './jira-interfaces.js'
import type {
  Comment,
  CreateEpicInput,
  CreateInitiativeInput,
  CreateTicketInput,
  EntityMetadata,
  Epic,
  Initiative,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../task-tracker/task-tracker.js'

const metadataExpandTitle = 'LLM Context'
const issueFields = 'summary,status,labels,assignee,description,issuelinks,updated'
const ideaIssueType = 'Idea'
const jpdProjectType = 'product_discovery'
const deliveryLinkOutward = 'implements'

/**
 * The Jira / Jira Product Discovery backend. Epics map to the Epic issue type
 * and tickets to Story; parentage rides the native `parent` field, and entity
 * metadata round-trips through the ADF description via {@link AdfMetadataService}.
 * Blocking dependencies ride "Blocks" issue links, resolved by name from the
 * instance, and entity metadata updates splice back through the description.
 * Initiatives map to JPD Ideas in the configured discovery project, linked to
 * delivery epics via the "Polaris issue link" type. TDDs arrive in a later
 * ticket and reject until then.
 */
export class JiraTaskTracker implements TaskTracker {
  private readonly client: JiraClient
  private readonly project: string
  private readonly jpdProject: string | undefined
  private readonly metadata: AdfMetadataService = new JiraAdfMetadataService()
  private issueTypeNames: string[] | undefined
  private blocksLinkType: string | undefined
  private deliveryLinkType: string | undefined
  private jpdProjectVerified = false

  constructor(config: JiraTrackerConfig) {
    this.client = new JiraClient({ host: config.host, email: config.email, token: config.token })
    this.project = config.project
    this.jpdProject = config.jpdProject
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

  async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(epicId, patch)
  }

  async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
    await this.spliceDescriptionMetadata(ticketId, patch)
  }

  updateTddMetadata(): Promise<void> {
    return this.notImplemented('updateTddMetadata')
  }

  async createInitiative(input: CreateInitiativeInput): Promise<Initiative> {
    const projectKey = await this.ensureJpdProject()

    const created = await this.client.request<JiraCreatedIssue>('POST', '/issue', {
      fields: {
        project: { key: projectKey },
        issuetype: { name: ideaIssueType },
        summary: input.title,
        description: adfBuilder.doc(input.body),
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

    await this.client.request('POST', '/issueLink', {
      type: { name: deliveryLinkType },
      inwardIssue: { key: initiativeId },
      outwardIssue: { key: epicId },
    })
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
      // On the fetched issue, Jira surfaces the partner in the partner's slot:
      // the blocker sits in outwardIssue (this issue is blocked by it), the
      // blocked sits in inwardIssue (this issue blocks it).
      if (link.outwardIssue !== undefined) blockedBy.push(link.outwardIssue.key)
      if (link.inwardIssue !== undefined) blocking.push(link.inwardIssue.key)
    })
    return { blockedBy, blocking }
  }

  private async spliceDescriptionMetadata(key: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${key}`, undefined, { fields: 'description' })
    const current = issue.fields.description ?? adfBuilder.doc('')
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
      this.issueTypeNames = meta.issueTypes.map((type) => type.name)
    }
    return this.issueTypeNames
  }

  private notImplemented(method: string): Promise<never> {
    return Promise.reject(new Error(`JiraTaskTracker.${method} not implemented`))
  }
}
