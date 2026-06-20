import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import { z } from 'zod'
import type {
  Comment,
  CreateEpicInput,
  CreateTicketInput,
  CreateTechnicalDesignInput,
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

const frTddRegex = /<!-- fr-tdd: (\d+) -->/
const frEpicRegex = /<!-- fr-epic: (\d+) -->/

const IssueRefListSchema = z.array(z.object({ number: z.number() }))

function parseTddId(body: string): number | null {
  const match = frTddRegex.exec(body)
  if (match === null || match[1] === undefined) return null
  return parseInt(match[1], 10)
}

function upsertFrTdd(body: string, tddId: number): string {
  const tag = `<!-- fr-tdd: ${tddId} -->`
  if (frTddRegex.test(body)) return body.replace(frTddRegex, tag)
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
  blockedBy: string[] = [],
  blocking: string[] = [],
): Ticket {
  return {
    id: String(issue.number),
    status: issue.state,
    labels: issue.labels.map(labelName).filter(Boolean),
    title: issue.title,
    body: issue.body ?? '',
    comments: comments.map(mapComment),
    assignee: issue.assignee?.login ?? null,
    blockedBy,
    blocking,
    updatedAt: issue.updated_at,
  }
}

export class GitHubTaskTracker implements TaskTracker {
  private octokit: Octokit
  private gql: ReturnType<typeof graphql.defaults>
  private owner: string
  private repo: string

  constructor(config: GitHubTrackerConfig) {
    this.octokit = new Octokit({ auth: config.token })
    this.gql = graphql.defaults({ headers: { authorization: `token ${config.token}` } })
    this.owner = config.owner
    this.repo = config.repo
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
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
      updatedAt: data.updated_at,
    }
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

    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map((ref) => String(ref.number))
    const childIssues = await Promise.all(childNumbers.map((n) => this.getTicket(n)))

    let tdd: TechnicalDesign | undefined
    const tddId = parseTddId(body)
    if (tddId !== null) {
      tdd = await this.getTechnicalDesign(String(tddId))
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
      updatedAt: issue.updated_at,
    }
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      labels: ['ticket', ...input.labels],
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    })
    await this.linkTicketToEpic(String(data.number), input.epicId)
    return mapTicket(data, [])
  }

  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10)
    const [issueResponse, commentsResponse] = await Promise.all([
      this.octokit.rest.issues.get({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
      this.octokit.rest.issues.listComments({ owner: this.owner, repo: this.repo, issue_number: issueNumber }),
    ])
    return mapTicket(issueResponse.data, commentsResponse.data)
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

    const body = `${input.body}\n<!-- fr-epic: ${input.epicId} -->`
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

    const epicResponse = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(input.epicId, 10),
    })
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(input.epicId, 10),
      body: upsertFrTdd(epicResponse.data.body ?? '', discussion.number),
    })

    return {
      id: String(discussion.number),
      epicId: input.epicId,
      body: discussion.body,
      comments: [],
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
    const epicMatch = frEpicRegex.exec(discussion.body)
    const epicId = epicMatch !== null && epicMatch[1] !== undefined ? epicMatch[1] : ''

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

  private async resolveIssueId(issueNumber: number): Promise<number> {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    })
    return data.id
  }
}
