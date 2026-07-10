import { JiraClient } from './jira-client.js'
import { adfBuilder, type AdfDocNode, type AdfNode } from './adf.js'
import { JiraAdfMetadataService, type AdfMetadataService } from './adf-metadata.js'
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
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
  type: { name: string }
  inwardIssue?: { key: string }
  outwardIssue?: { key: string }
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

const metadataExpandTitle = 'LLM Context'
const issueFields = 'summary,status,labels,assignee,description,issuelinks,updated'

/**
 * The Jira / Jira Product Discovery backend. Epics map to the Epic issue type
 * and tickets to Story; parentage rides the native `parent` field, and entity
 * metadata round-trips through the ADF description via {@link AdfMetadataService}.
 * Initiatives, TDDs, comments, and direction-aware blocking arrive in later
 * tickets and reject until then.
 */
export class JiraTaskTracker implements TaskTracker {
  private readonly client: JiraClient
  private readonly project: string
  private readonly metadata: AdfMetadataService = new JiraAdfMetadataService()
  private issueTypeNames: string[] | undefined

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
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${id}`, undefined, { fields: issueFields })
    return this.mapTicket(issue)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const issue = await this.client.request<JiraIssue>('GET', `/issue/${ticketId}`, undefined, { fields: 'parent' })
    if (issue.fields.parent?.key === epicId) return

    await this.client.request('PUT', `/issue/${ticketId}`, { fields: { parent: { key: epicId } } })
  }

  blockTicket(): Promise<void> {
    return this.notImplemented('blockTicket')
  }

  unblockTicket(): Promise<void> {
    return this.notImplemented('unblockTicket')
  }

  updateEpicMetadata(): Promise<void> {
    return this.notImplemented('updateEpicMetadata')
  }

  updateTicketMetadata(): Promise<void> {
    return this.notImplemented('updateTicketMetadata')
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

  addComment(): Promise<Comment> {
    return this.notImplemented('addComment')
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
    const page = await this.client.request<JiraSearchResponse>('GET', '/search', undefined, {
      jql: `parent = ${epicKey}`,
      fields: issueFields,
      maxResults: 100,
    })
    return page.issues.map((issue) => this.mapTicket(issue))
  }

  private mapTicket(issue: JiraIssue): Ticket {
    const { blockedBy, blocking } = this.blockingLinks(issue.fields.issuelinks ?? [])
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

  private blockingLinks(links: JiraIssueLink[]): { blockedBy: string[]; blocking: string[] } {
    const blockedBy: string[] = []
    const blocking: string[] = []
    links.forEach((link) => {
      if (link.type.name !== 'Blocks') return
      if (link.inwardIssue !== undefined) blockedBy.push(link.inwardIssue.key)
      if (link.outwardIssue !== undefined) blocking.push(link.outwardIssue.key)
    })
    return { blockedBy, blocking }
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
