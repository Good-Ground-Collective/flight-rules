import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import { BodyMetadataService } from '../body-metadata/body-metadata.js'
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
  EntityMetadata,
  Epic,
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

const frTicketsRegex = /<!-- fr-tickets: (\[.*?\]) -->/s

function parseTicketIds(body: string): number[] {
  const match = frTicketsRegex.exec(body)
  if (match === null || match[1] === undefined) return []
  try {
    const parsed: unknown = JSON.parse(match[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is number => typeof x === 'number')
  } catch {
    return []
  }
}

function upsertFrTickets(body: string, ticketIds: number[]): string {
  const tag = `<!-- fr-tickets: ${JSON.stringify(ticketIds)} -->`
  if (frTicketsRegex.test(body)) return body.replace(frTicketsRegex, tag)
  return `${body}\n${tag}`
}

function labelName(label: OctokitLabelData): string {
  if (typeof label === 'string') return label
  return label.name ?? ''
}

function mapComment(c: OctokitCommentData): Comment {
  return {
    id: String(c.id),
    body: c.body ?? '',
    author: c.user?.login ?? '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

function mapTicket(
  issue: OctokitIssueData,
  comments: OctokitCommentData[],
  metadata: EntityMetadata = {},
): Ticket {
  return {
    id: String(issue.number),
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body: issue.body ?? '',
    comments: comments.map(mapComment),
    assignee: issue.assignee?.login ?? null,
    metadata,
    updatedAt: issue.updated_at,
  }
}

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
      labels: data.labels.map(labelName).filter(Boolean),
      title: data.title,
      body: data.body ?? '',
      childIssues: [],
      comments: [],
      metadata: this.bodyMetadata.parse(data.body ?? ''),
      updatedAt: data.updated_at,
    }
  }

  async getEpic(id: string): Promise<Epic> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    ])
    const issue = issueResponse.data
    const body = issue.body ?? ''
    const metadata = this.bodyMetadata.parse(body)

    const ticketIds = parseTicketIds(body)
    const childIssues = await Promise.all(ticketIds.map((n) => this.getTicket(String(n))))

    let tdd: TechnicalDesign | undefined
    if (metadata.tddId !== undefined) {
      tdd = await this.getTechnicalDesign(String(metadata.tddId))
    }

    return {
      id,
      status: issue.state,
      labels: issue.labels.map(labelName).filter(Boolean),
      title: issue.title,
      body,
      childIssues,
      comments: commentsResponse.data.map(mapComment),
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
    return mapTicket(data, [], {})
  }

  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    ])
    const body = issueResponse.data.body ?? ''
    const metadata = this.bodyMetadata.parse(body)
    return mapTicket(issueResponse.data, commentsResponse.data, metadata)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const epicNumber = parseInt(epicId, 10)
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
    })
    const currentBody = data.body ?? ''
    const existingIds = parseTicketIds(currentBody)
    const ticketNumber = parseInt(ticketId, 10)
    if (existingIds.includes(ticketNumber)) return
    const newBody = upsertFrTickets(currentBody, [...existingIds, ticketNumber])
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      body: newBody,
    })
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
}
