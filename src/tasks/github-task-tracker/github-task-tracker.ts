import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import { BodyMetadataService } from '../body-metadata/body-metadata.js'
import { z } from 'zod'
import type {
  Comment,
  CreateEpicInput,
  CreateInitiativeInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
  EntityMetadata,
  Epic,
  Initiative,
  TaskTracker,
  TechnicalDesign,
  Ticket,
} from '../task-tracker/task-tracker.js'

interface GitHubTrackerConfig {
  token: string
  owner: string
  repo: string
}

type OctokitIssueData = Awaited<ReturnType<Octokit['rest']['issues']['get']>>['data']
type OctokitCommentData = Awaited<ReturnType<Octokit['rest']['issues']['listComments']>>['data'][number]
type OctokitLabelData = OctokitIssueData['labels'][number]

const IssueRefListSchema = z.array(z.object({ number: z.number() }))

export class GitHubTaskTracker implements TaskTracker {
  private octokit: Octokit
  private gql: ReturnType<typeof graphql.defaults>
  private owner: string
  private repo: string
  private readonly bodyMetadata = new BodyMetadataService()

  constructor(config: GitHubTrackerConfig) {
    this.octokit = new Octokit({ auth: config.token })
    this.gql = graphql.defaults({ headers: { authorization: `token ${config.token}` } })
    this.owner = config.owner
    this.repo = config.repo
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {})
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ['epic', ...input.labels],
    })
    return {
      id: String(data.number),
      status: data.state,
      labels: data.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: data.title,
      body: data.body ?? '',
      childIssues: [],
      comments: [],
      metadata: this.bodyMetadata.parse(data.body ?? ''),
      updatedAt: data.updated_at,
    }
  }

  async createInitiative(input: CreateInitiativeInput): Promise<Initiative> {
    const { data } = await this.octokit.rest.issues.createMilestone({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      description: input.body,
    })
    return {
      id: String(data.number),
      title: data.title,
      body: data.description ?? '',
      epics: [],
    }
  }

  async getInitiative(id: string): Promise<Initiative> {
    const milestoneNumber = parseInt(id, 10)
    const [milestoneResponse, epicsResponse] = await Promise.all([
      this.octokit.rest.issues.getMilestone({
        owner: this.owner,
        repo: this.repo,
        milestone_number: milestoneNumber,
      }),
      this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        milestone: String(milestoneNumber),
        labels: 'epic',
        state: 'all',
      }),
    ])
    const milestone = milestoneResponse.data
    return {
      id,
      title: milestone.title,
      body: milestone.description ?? '',
      epics: epicsResponse.data.map((issue) => ({
        id: String(issue.number),
        title: issue.title,
      })),
    }
  }

  async linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(epicId, 10),
      milestone: parseInt(initiativeId, 10),
    })
  }

  async getEpic(id: string): Promise<Epic> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse, subIssuesResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ])
    const issue = issueResponse.data
    const body = issue.body ?? ''
    const metadata = this.bodyMetadata.parse(body)

    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map((ref) => String(ref.number))
    const childIssues = await Promise.all(childNumbers.map((n) => this.getTicket(n)))

    let tdd: TechnicalDesign | undefined
    if (metadata.tddId !== undefined) {
      tdd = await this.getTechnicalDesign(String(metadata.tddId))
    }

    return {
      id,
      status: issue.state,
      labels: issue.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: issue.title,
      body,
      childIssues,
      comments: commentsResponse.data.map((c) => this.mapComment(c)),
      tdd,
      metadata,
      updatedAt: issue.updated_at,
    }
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {})
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ['ticket', ...input.labels],
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    })
    await this.linkTicketToEpic(String(data.number), input.epicId)
    return this.mapTicket(data, [], [], [], this.bodyMetadata.parse(data.body ?? ''))
  }

  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse, blockedByResponse, blockingResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
      this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking', {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ])
    const body = issueResponse.data.body ?? ''
    const metadata = this.bodyMetadata.parse(body)
    const blockedBy = IssueRefListSchema.parse(blockedByResponse.data).map((ref) => String(ref.number))
    const blocking = IssueRefListSchema.parse(blockingResponse.data).map((ref) => String(ref.number))
    return this.mapTicket(issueResponse.data, commentsResponse.data, blockedBy, blocking, metadata)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const epicNumber = parseInt(epicId, 10)
    const ticketNumber = parseInt(ticketId, 10)
    const existing = await this.octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { owner: this.owner, repo: this.repo, issue_number: epicNumber },
    )
    const childNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number)
    if (childNumbers.includes(ticketNumber)) return
    const subIssueId = await this.resolveIssueId(ticketNumber)
    await this.octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      sub_issue_id: subIssueId,
    })
  }

  async blockTicket(ticketId: string, blockedById: string): Promise<void> {
    if (ticketId === blockedById) throw new Error('a ticket cannot block itself')
    const ticketNumber = parseInt(ticketId, 10)
    const blockerNumber = parseInt(blockedById, 10)
    const existing = await this.octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber },
    )
    const blockerNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number)
    if (blockerNumbers.includes(blockerNumber)) return
    const issueId = await this.resolveIssueId(blockerNumber)
    await this.octokit.request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    )
  }

  async unblockTicket(ticketId: string, blockedById: string): Promise<void> {
    const ticketNumber = parseInt(ticketId, 10)
    const issueId = await this.resolveIssueId(parseInt(blockedById, 10))
    await this.octokit.request(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}',
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    )
  }

  async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issueNumber = parseInt(epicId, 10)
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    })
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? '', patch),
    })
  }

  async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issueNumber = parseInt(ticketId, 10)
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    })
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? '', patch),
    })
  }

  async updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const fetchData = await this.gql<{
      repository: { discussion: { id: string; body: string } | null }
    }>(
      `query GetDiscussionForUpdate($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id body }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(tddId, 10) },
    )
    const discussion = fetchData.repository.discussion
    if (discussion === null) throw new Error(`Discussion #${tddId} not found`)
    await this.gql(
      `mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
        updateDiscussion(input: { discussionId: $discussionId, body: $body }) {
          discussion { number }
        }
      }`,
      {
        discussionId: discussion.id,
        body: this.bodyMetadata.splice(discussion.body, patch),
      },
    )
  }

  async createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign> {
    const repoData = await this.gql<{
      repository: { id: string; discussionCategory: { id: string } | null }
    }>(
      `query GetRepoAndCategory($owner: String!, $repo: String!, $slug: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategory(slug: $slug) { id }
        }
      }`,
      { owner: this.owner, repo: this.repo, slug: 'tdds' },
    )

    const categoryId = repoData.repository.discussionCategory?.id
    if (categoryId === undefined) {
      throw new Error('No "TDDs" discussion category found. Create it in the repo\'s GitHub Discussions settings.')
    }

    const body = this.bodyMetadata.splice(input.body, {
      epicId: parseInt(input.epicId, 10),
      ...input.metadata,
    })
    const createData = await this.gql<{
      createDiscussion: {
        discussion: { number: number; body: string; updatedAt: string }
      }
    }>(
      `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { number body updatedAt }
        }
      }`,
      { repositoryId: repoData.repository.id, categoryId, title: input.title, body },
    )

    const discussion = createData.createDiscussion.discussion

    await this.updateEpicMetadata(input.epicId, { tddId: discussion.number })

    return {
      id: String(discussion.number),
      epicId: input.epicId,
      body: discussion.body,
      comments: [],
      metadata: this.bodyMetadata.parse(discussion.body),
      updatedAt: discussion.updatedAt,
    }
  }

  async getTechnicalDesign(id: string): Promise<TechnicalDesign> {
    const data = await this.gql<{
      repository: {
        discussion: {
          number: number
          body: string
          updatedAt: string
          comments: {
            nodes: Array<{
              id: string
              body: string
              author: { login: string } | null
              createdAt: string
              updatedAt: string
            }>
          }
        } | null
      }
    }>(
      `query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            number body updatedAt
            comments(first: 100) {
              nodes { id body author { login } createdAt updatedAt }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) },
    )

    const discussion = data.repository.discussion
    if (discussion === null) {
      throw new Error(`Discussion #${id} not found`)
    }
    const metadata = this.bodyMetadata.parse(discussion.body)
    const epicId = metadata.epicId !== undefined ? String(metadata.epicId) : ''

    return {
      id,
      epicId,
      body: discussion.body,
      comments: discussion.comments.nodes.map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author?.login ?? '',
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      metadata,
      updatedAt: discussion.updatedAt,
    }
  }

  async addComment(entityId: string, body: string): Promise<Comment> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(entityId, 10),
      body,
    })
    return {
      id: String(data.id),
      body: data.body ?? '',
      author: data.user?.login ?? '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  }

  async getUsers(): Promise<string[]> {
    const { data } = await this.octokit.rest.orgs.listMembers({
      org: this.owner,
      per_page: 100,
    })
    return data.map((member) => member.login)
  }

  async ping(): Promise<void> {
    await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo })
  }

  private async resolveIssueId(issueNumber: number): Promise<number> {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    })
    return data.id
  }

  private labelName(label: OctokitLabelData): string {
    if (typeof label === 'string') return label
    return label.name ?? ''
  }

  private mapComment(c: OctokitCommentData): Comment {
    return {
      id: String(c.id),
      body: c.body ?? '',
      author: c.user?.login ?? '',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }
  }

  private mapTicket(
    issue: OctokitIssueData,
    comments: OctokitCommentData[],
    blockedBy: string[] = [],
    blocking: string[] = [],
    metadata: EntityMetadata = {},
  ): Ticket {
    return {
      id: String(issue.number),
      status: issue.state,
      labels: issue.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: issue.title,
      body: issue.body ?? '',
      comments: comments.map((c) => this.mapComment(c)),
      assignee: issue.assignee?.login ?? null,
      blockedBy,
      blocking,
      metadata,
      updatedAt: issue.updated_at,
    }
  }
}
