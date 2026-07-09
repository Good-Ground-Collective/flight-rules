import { JiraClient } from './jira-client.js'
import type {
  Comment,
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

// The Jira/JPD backend. This ticket delivers the selectable, health-checkable
// shell: ping() and getUsers() are live; the remaining TaskTracker methods are
// filled in by later tickets (T4–T8) and reject until then. Stubs omit their
// parameters (a lower-arity method still satisfies the interface) so the
// scaffold stays lint-clean; each ticket reintroduces the real signature.
export class JiraTaskTracker implements TaskTracker {
  private readonly client: JiraClient
  private readonly project: string

  // jpdProject / confluenceSpaceKey are accepted (the config seam T7/T8 need)
  // but not stored until those tickets consume them.
  constructor(config: JiraTrackerConfig) {
    this.client = new JiraClient({ host: config.host, email: config.email, token: config.token })
    this.project = config.project
  }

  createEpic(): Promise<Epic> {
    return this.notImplemented('createEpic')
  }

  getEpic(): Promise<Epic> {
    return this.notImplemented('getEpic')
  }

  createTicket(): Promise<Ticket> {
    return this.notImplemented('createTicket')
  }

  getTicket(): Promise<Ticket> {
    return this.notImplemented('getTicket')
  }

  linkTicketToEpic(): Promise<void> {
    return this.notImplemented('linkTicketToEpic')
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

  private notImplemented(method: string): Promise<never> {
    return Promise.reject(new Error(`JiraTaskTracker.${method} not implemented`))
  }
}
