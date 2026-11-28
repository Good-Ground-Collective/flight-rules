import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { BodyMetadataService } from "../body-metadata/body-metadata.js";
import { z } from "zod";
import { UnsupportedTrackerOperationError } from "../task-tracker/unsupported-tracker-operation-error.js";
import { TaskTrackerPartialWriteError } from "../task-tracker/task-tracker.js";
import type {
  Attachment,
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
  TrackerUser,
  UpdateEpicInput,
  UpdateInitiativeInput,
  UpdateTechnicalDesignInput,
  UpdateTicketInput,
} from "../task-tracker/task-tracker.js";

export interface GitHubTrackerConfig {
  token: string;
  owner: string;
  repo: string;
}

type OctokitIssueData = Awaited<ReturnType<Octokit["rest"]["issues"]["get"]>>["data"];
type OctokitCommentData = Awaited<
  ReturnType<Octokit["rest"]["issues"]["listComments"]>
>["data"][number];
type OctokitLabelData = OctokitIssueData["labels"][number];

const IssueRefSchema = z.object({ number: z.number() });
const IssueRefListSchema = z.array(IssueRefSchema);
const ParentNotFoundSchema = z.object({ status: z.literal(404) });
const ProjectNotFoundSchema = z.object({
  errors: z.array(
    z.object({
      type: z.string().optional(),
      path: z.array(z.union([z.string(), z.number()])).optional(),
    }),
  ),
});

type ProjectItemsResponse = {
  repositoryOwner: {
    projectV2?: {
      title: string;
      readme: string | null;
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          content: {
            number?: number;
            title?: string;
            repository?: { name: string; owner: { login: string } };
            labels?: { nodes: Array<{ name: string } | null> };
          } | null;
        } | null>;
      };
    } | null;
  } | null;
};

export class GitHubTaskTracker implements TaskTracker {
  private octokit: Octokit;
  private gql: ReturnType<typeof graphql.defaults>;
  private owner: string;
  private repo: string;
  private readonly bodyMetadata = new BodyMetadataService();

  constructor(config: GitHubTrackerConfig) {
    this.octokit = new Octokit({ auth: config.token });
    this.gql = graphql.defaults({ headers: { authorization: `token ${config.token}` } });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {});
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ["epic", ...input.labels],
    });
    return {
      id: String(data.number),
      size: "epic",
      status: data.state,
      labels: data.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: data.title,
      body: data.body ?? "",
      childIssues: [],
      comments: [],
      metadata: this.bodyMetadata.parse(data.body ?? ""),
      updatedAt: data.updated_at,
    };
  }

  // Initiatives are GitHub Projects (v2) owned by the repo owner and linked to
  // the repo. The layered body lives in the project README; epics are project
  // items. Project numbers are owner-scoped, so they can collide with issue numbers.
  async createInitiative(input: CreateInitiativeInput): Promise<Initiative> {
    const { repository } = await this.gql<{ repository: { id: string; owner: { id: string } } }>(
      `query InitiativeOwner($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) { id owner { id } }
      }`,
      { owner: this.owner, repo: this.repo },
    );
    const { createProjectV2 } = await this.gql<{
      createProjectV2: { projectV2: { id: string; number: number; title: string } };
    }>(
      `mutation CreateInitiative($ownerId: ID!, $repositoryId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, repositoryId: $repositoryId, title: $title }) {
          projectV2 { id number title }
        }
      }`,
      { ownerId: repository.owner.id, repositoryId: repository.id, title: input.title },
    );
    const project = createProjectV2.projectV2;
    const id = String(project.number);
    try {
      await this.updateProjectReadme(project.id, input.body);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id, cause });
    }
    return { id, size: "initiative", title: project.title, body: input.body, epics: [] };
  }

  async getInitiative(id: string): Promise<Initiative> {
    const number = this.projectNumber(id);
    let title: string | undefined;
    let body: string | undefined;
    const epics: Initiative["epics"] = [];
    let after: string | null = null;
    do {
      const response: ProjectItemsResponse = await this.projectQuery<ProjectItemsResponse>(
        id,
        `query GetInitiative($owner: String!, $number: Int!, $after: String) {
          repositoryOwner(login: $owner) {
            ... on ProjectV2Owner {
              projectV2(number: $number) {
                title
                readme
                items(first: 100, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    content {
                      ... on Issue {
                        number
                        title
                        repository { name owner { login } }
                        labels(first: 50) { nodes { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { owner: this.owner, number, after },
      );
      const project = response.repositoryOwner?.projectV2;
      if (!project) throw this.initiativeNotFound(id);
      title = project.title;
      body = project.readme ?? "";
      for (const item of project.items.nodes) {
        const issue = item?.content;
        if (!issue?.number || !issue.repository || !this.isThisRepo(issue.repository)) continue;
        if (!issue.labels?.nodes.some((label) => label?.name === "epic")) continue;
        epics.push({ id: String(issue.number), title: issue.title ?? "" });
      }
      after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
    } while (after);
    return { id, size: "initiative", title: title ?? "", body: body ?? "", epics };
  }

  async linkEpicToInitiative(epicId: string, initiativeId: string): Promise<void> {
    const { repositoryOwner, repository } = await this.projectQuery<{
      repositoryOwner: { projectV2?: { id: string } | null } | null;
      repository: { issue: { id: string } | null };
    }>(
      initiativeId,
      `query LinkEpicTargets($owner: String!, $repo: String!, $number: Int!, $issue: Int!) {
        repositoryOwner(login: $owner) {
          ... on ProjectV2Owner { projectV2(number: $number) { id } }
        }
        repository(owner: $owner, name: $repo) { issue(number: $issue) { id } }
      }`,
      {
        owner: this.owner,
        repo: this.repo,
        number: this.projectNumber(initiativeId),
        issue: parseInt(epicId, 10),
      },
    );
    const projectId = repositoryOwner?.projectV2?.id;
    if (!projectId) throw this.initiativeNotFound(initiativeId);
    if (!repository.issue)
      throw new Error(`epic ${epicId} not found in ${this.owner}/${this.repo}`);
    await this.gql(
      `mutation LinkEpicToInitiative($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
      }`,
      { projectId, contentId: repository.issue.id },
    );
  }

  async getEpic(id: string): Promise<Epic> {
    const issueNumber = parseInt(id, 10);
    const [issueResponse, commentsResponse, subIssuesResponse] = await Promise.all([
      this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
      this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
      this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      }),
    ]);
    const issue = issueResponse.data;
    const body = issue.body ?? "";
    const metadata = this.bodyMetadata.parse(body);

    const childNumbers = IssueRefListSchema.parse(subIssuesResponse.data).map((ref) =>
      String(ref.number),
    );
    const childIssues = await Promise.all(childNumbers.map((n) => this.getTicket(n)));

    let tdd: TechnicalDesign | undefined;
    if (metadata.tddId !== undefined) {
      tdd = await this.getTechnicalDesign(String(metadata.tddId));
    }

    return {
      id,
      size: "epic",
      status: issue.state,
      labels: issue.labels.map((l) => this.labelName(l)).filter(Boolean),
      title: issue.title,
      body,
      childIssues,
      comments: commentsResponse.data.map((c) => this.mapComment(c)),
      tdd,
      metadata,
      updatedAt: issue.updated_at,
    };
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const body = this.bodyMetadata.splice(input.body, input.metadata ?? {});
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body,
      labels: ["ticket", ...input.labels],
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    });
    if (input.epicId !== undefined) {
      try {
        await this.linkTicketToEpic(String(data.number), input.epicId);
      } catch (cause) {
        throw new TaskTrackerPartialWriteError({ id: String(data.number), cause });
      }
    }
    return this.mapTicket(data, [], [], [], this.bodyMetadata.parse(data.body ?? ""));
  }

  async getTicket(id: string): Promise<Ticket> {
    const issueNumber = parseInt(id, 10);
    const [issueResponse, commentsResponse, blockedByResponse, blockingResponse] =
      await Promise.all([
        this.octokit.rest.issues.get({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
        }),
        this.octokit.rest.issues.listComments({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
        }),
        this.octokit.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
          {
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
          },
        ),
        this.octokit.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking",
          {
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
          },
        ),
      ]);
    const body = issueResponse.data.body ?? "";
    const metadata = this.bodyMetadata.parse(body);
    const blockedBy = IssueRefListSchema.parse(blockedByResponse.data).map((ref) =>
      String(ref.number),
    );
    const blocking = IssueRefListSchema.parse(blockingResponse.data).map((ref) =>
      String(ref.number),
    );
    return this.mapTicket(issueResponse.data, commentsResponse.data, blockedBy, blocking, metadata);
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    const epicNumber = parseInt(epicId, 10);
    const ticketNumber = parseInt(ticketId, 10);
    const existing = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { owner: this.owner, repo: this.repo, issue_number: epicNumber },
    );
    const childNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number);
    if (childNumbers.includes(ticketNumber)) return;
    const subIssueId = await this.resolveIssueId(ticketNumber);
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
      owner: this.owner,
      repo: this.repo,
      issue_number: epicNumber,
      sub_issue_id: subIssueId,
    });
  }

  async getTicketEpicId(ticketId: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
        {
          owner: this.owner,
          repo: this.repo,
          issue_number: parseInt(ticketId, 10),
        },
      );
      return String(IssueRefSchema.parse(data).number);
    } catch (error) {
      // GitHub answers 404 "No parent issue found" for an issue that is not a sub-issue.
      if (ParentNotFoundSchema.safeParse(error).success) return null;
      throw error;
    }
  }

  async blockTicket(ticketId: string, blockedById: string): Promise<void> {
    if (ticketId === blockedById) throw new Error("a ticket cannot block itself");
    const ticketNumber = parseInt(ticketId, 10);
    const blockerNumber = parseInt(blockedById, 10);
    const existing = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber },
    );
    const blockerNumbers = IssueRefListSchema.parse(existing.data).map((ref) => ref.number);
    if (blockerNumbers.includes(blockerNumber)) return;
    const issueId = await this.resolveIssueId(blockerNumber);
    await this.octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    );
  }

  async unblockTicket(ticketId: string, blockedById: string): Promise<void> {
    const ticketNumber = parseInt(ticketId, 10);
    const issueId = await this.resolveIssueId(parseInt(blockedById, 10));
    await this.octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}",
      { owner: this.owner, repo: this.repo, issue_number: ticketNumber, issue_id: issueId },
    );
  }

  async transitionTicket(ticketId: string, status: string): Promise<void> {
    // GitHub has no native in-progress/in-review concept, so status is encoded
    // as a `status:<slug>` label (matching the epic/ticket label convention).
    const issueNumber = parseInt(ticketId, 10);
    const slug = `status:${status.trim().toLowerCase().replace(/\s+/g, "-")}`;
    // A label the repo already defines under different capitalisation is the
    // same status, so reuse its exact name rather than adding a second label.
    const existing = await this.statusLabelNames();
    const label = existing.find((name) => name.toLowerCase() === slug) ?? slug;
    const { data: issue } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    const stale = issue.labels
      .map((l) => this.labelName(l))
      .filter((name) => name.startsWith("status:") && name.toLowerCase() !== label.toLowerCase());
    for (const name of stale) {
      await this.octokit.rest.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name,
      });
    }
    await this.octokit.rest.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels: [label],
    });
  }

  async listTransitions(): Promise<string[]> {
    // The vocabulary is repo-wide, so the ticket id is irrelevant; lowercased so the value round-trips through transitionTicket to the same label.
    return (await this.statusLabelNames()).map((name) =>
      name.slice("status:".length).replace(/-/g, " ").toLowerCase(),
    );
  }

  /**
   * GitHub labels double as the tracker's type system — `epic`/`ticket` and
   * `status:<slug>` — so a generic label write could silently change a
   * ticket's size or status. Label lifecycle writes are Jira-only.
   */
  addLabel(ticketId: string, label: string): Promise<void> {
    return Promise.reject(
      new UnsupportedTrackerOperationError({
        tracker: "GitHub",
        operation: `adding the label "${label}" to issue #${ticketId}`,
        remedy:
          "GitHub labels encode issue size and status and are owned by the tracker; use --tracker jira",
      }),
    );
  }

  removeLabel(ticketId: string, label: string): Promise<void> {
    return Promise.reject(
      new UnsupportedTrackerOperationError({
        tracker: "GitHub",
        operation: `removing the label "${label}" from issue #${ticketId}`,
        remedy:
          "GitHub labels encode issue size and status and are owned by the tracker; use --tracker jira",
      }),
    );
  }

  async updateEpicMetadata(epicId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issueNumber = parseInt(epicId, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? "", patch),
    });
  }

  async updateTicketMetadata(ticketId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const issueNumber = parseInt(ticketId, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: this.bodyMetadata.splice(data.body ?? "", patch),
    });
  }

  async updateEpicDescription(epicId: string, input: UpdateEpicInput): Promise<Epic> {
    await this.replaceIssueBody(epicId, "epic", input);
    try {
      return await this.getEpic(epicId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: epicId, cause });
    }
  }

  async updateTicketDescription(ticketId: string, input: UpdateTicketInput): Promise<Ticket> {
    await this.replaceIssueBody(ticketId, "ticket", input);
    try {
      return await this.getTicket(ticketId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: ticketId, cause });
    }
  }

  async updateInitiativeDescription(
    initiativeId: string,
    input: UpdateInitiativeInput,
  ): Promise<Initiative> {
    // Initiatives are projects: a title and README body, no labels or metadata.
    const projectId = await this.projectNodeId(initiativeId);
    await this.updateProjectReadme(projectId, input.body, input.title);
    try {
      return await this.getInitiative(initiativeId);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: initiativeId, cause });
    }
  }

  async updateTddMetadata(tddId: string, patch: Partial<EntityMetadata>): Promise<void> {
    const fetchData = await this.gql<{
      repository: { discussion: { id: string; body: string } | null };
    }>(
      `query GetDiscussionForUpdate($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id body }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(tddId, 10) },
    );
    const discussion = fetchData.repository.discussion;
    if (discussion === null) throw new Error(`Discussion #${tddId} not found`);
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
    );
  }

  async createTechnicalDesign(input: CreateTechnicalDesignInput): Promise<TechnicalDesign> {
    const repoData = await this.gql<{
      repository: { id: string; discussionCategory: { id: string } | null };
    }>(
      `query GetRepoAndCategory($owner: String!, $repo: String!, $slug: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategory(slug: $slug) { id }
        }
      }`,
      { owner: this.owner, repo: this.repo, slug: "tdds" },
    );

    const categoryId = repoData.repository.discussionCategory?.id;
    if (categoryId === undefined) {
      throw new Error(
        'No "TDDs" discussion category found. Create it in the repo\'s GitHub Discussions settings.',
      );
    }

    const body = this.bodyMetadata.splice(input.body, {
      epicId: parseInt(input.epicId, 10),
      ...input.metadata,
    });
    const createData = await this.gql<{
      createDiscussion: {
        discussion: { number: number; body: string; updatedAt: string; url?: string };
      };
    }>(
      `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion { number body updatedAt url }
        }
      }`,
      { repositoryId: repoData.repository.id, categoryId, title: input.title, body },
    );

    const discussion = createData.createDiscussion.discussion;

    try {
      await this.updateEpicMetadata(input.epicId, { tddId: discussion.number });
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id: String(discussion.number), cause });
    }

    return {
      id: String(discussion.number),
      epicId: input.epicId,
      ...(discussion.url !== undefined ? { url: discussion.url } : {}),
      body: discussion.body,
      comments: [],
      attachments: [],
      metadata: this.bodyMetadata.parse(discussion.body),
      updatedAt: discussion.updatedAt,
    };
  }

  async updateTechnicalDesign(
    id: string,
    input: UpdateTechnicalDesignInput,
  ): Promise<TechnicalDesign> {
    const fetched = await this.gql<{
      repository: { discussion: { id: string; body: string } | null };
    }>(
      `query GetDiscussionForEdit($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id body }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) },
    );
    const discussion = fetched.repository.discussion;
    if (discussion === null) throw new Error(`Discussion #${id} not found`);

    const changes = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.body === undefined
        ? {}
        : { body: this.bodyMetadata.splice(input.body, this.bodyMetadata.parse(discussion.body)) }),
    };
    await this.gql(
      `mutation UpdateDiscussion($discussionId: ID!, $title: String, $body: String) {
        updateDiscussion(input: { discussionId: $discussionId, title: $title, body: $body }) {
          discussion { number }
        }
      }`,
      { discussionId: discussion.id, ...changes },
    );

    try {
      return await this.getTechnicalDesign(id);
    } catch (cause) {
      throw new TaskTrackerPartialWriteError({ id, cause });
    }
  }

  async getTechnicalDesign(id: string): Promise<TechnicalDesign> {
    const data = await this.gql<{
      repository: {
        discussion: {
          number: number;
          body: string;
          updatedAt: string;
          url?: string;
          comments: {
            nodes: Array<{
              id: string;
              body: string;
              author: { login: string } | null;
              createdAt: string;
              updatedAt: string;
            }>;
          };
        } | null;
      };
    }>(
      `query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            number body updatedAt url
            comments(first: 100) {
              nodes { id body author { login } createdAt updatedAt }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) },
    );

    const discussion = data.repository.discussion;
    if (discussion === null) {
      throw new Error(`Discussion #${id} not found`);
    }
    const metadata = this.bodyMetadata.parse(discussion.body);
    const epicId = metadata.epicId !== undefined ? String(metadata.epicId) : "";

    return {
      id,
      epicId,
      ...(discussion.url !== undefined ? { url: discussion.url } : {}),
      body: discussion.body,
      comments: discussion.comments.nodes.map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author?.login ?? "",
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      attachments: [],
      metadata,
      updatedAt: discussion.updatedAt,
    };
  }

  // eslint-disable-next-line preflight/no-throw-helpers -- a capability stub's whole body is the throw
  assertTechnicalDesignAttachments(): never {
    throw new UnsupportedTrackerOperationError({
      tracker: "GitHub",
      operation: "attaching files to a technical design",
      remedy:
        "GitHub Discussions have no attachment API; use --tracker jira, or reference an image by URL in the body",
    });
  }

  async addTechnicalDesignAttachment(): Promise<Attachment> {
    return this.assertTechnicalDesignAttachments();
  }

  async addTechnicalDesignComment(id: string, body: string): Promise<Comment> {
    const fetchData = await this.gql<{
      repository: { discussion: { id: string } | null };
    }>(
      `query GetDiscussionForComment($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) { id }
        }
      }`,
      { owner: this.owner, repo: this.repo, number: parseInt(id, 10) },
    );
    const discussion = fetchData.repository.discussion;
    if (discussion === null) throw new Error(`Discussion #${id} not found`);

    const data = await this.gql<{
      addDiscussionComment: {
        comment: {
          id: string;
          body: string;
          author: { login: string } | null;
          createdAt: string;
          updatedAt: string;
        };
      };
    }>(
      `mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment { id body author { login } createdAt updatedAt }
        }
      }`,
      { discussionId: discussion.id, body },
    );
    const comment = data.addDiscussionComment.comment;
    return {
      id: comment.id,
      body: comment.body,
      author: comment.author?.login ?? "",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  async addComment(entityId: string, body: string): Promise<Comment> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: parseInt(entityId, 10),
      body,
    });
    return {
      id: String(data.id),
      body: data.body ?? "",
      author: data.user?.login ?? "",
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  // eslint-disable-next-line preflight/no-throw-helpers -- a capability stub's whole body is the throw
  async addAttachment(ticketId: string, filePath: string): Promise<Attachment> {
    throw new UnsupportedTrackerOperationError({
      tracker: "GitHub",
      operation: `attaching ${filePath} to issue #${ticketId}`,
      remedy:
        "GitHub issues have no attachment API; use --tracker jira, or gh --attach for pull requests",
    });
  }

  async getUsers(): Promise<TrackerUser[]> {
    const { data } = await this.octokit.rest.orgs.listMembers({
      org: this.owner,
      per_page: 100,
    });
    return data.map((member) => ({ accountId: member.login, displayName: member.login }));
  }

  async ping(options?: { signal?: AbortSignal }): Promise<void> {
    await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
      ...(options?.signal === undefined ? {} : { request: { signal: options.signal } }),
    });
  }

  private projectNumber(initiativeId: string): number {
    const number = Number(initiativeId);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`initiative id must be a GitHub Project number, got "${initiativeId}"`);
    }
    return number;
  }

  /** Runs a project lookup, mapping GitHub's NOT_FOUND on `projectV2` to a readable error. */
  private async projectQuery<T>(
    initiativeId: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.gql<T>(query, variables);
    } catch (error) {
      const parsed = ProjectNotFoundSchema.safeParse(error);
      if (
        parsed.success &&
        parsed.data.errors.some((e) => e.type === "NOT_FOUND" && e.path?.includes("projectV2"))
      ) {
        throw this.initiativeNotFound(initiativeId);
      }
      throw error;
    }
  }

  private initiativeNotFound(initiativeId: string): Error {
    return new Error(
      `initiative ${initiativeId} not found: no GitHub Project #${initiativeId} owned by ${this.owner}`,
    );
  }

  private isThisRepo(repository: { name: string; owner: { login: string } }): boolean {
    return (
      repository.name.toLowerCase() === this.repo.toLowerCase() &&
      repository.owner.login.toLowerCase() === this.owner.toLowerCase()
    );
  }

  private async projectNodeId(initiativeId: string): Promise<string> {
    const { repositoryOwner } = await this.projectQuery<{
      repositoryOwner: { projectV2?: { id: string } | null } | null;
    }>(
      initiativeId,
      `query InitiativeProjectId($owner: String!, $number: Int!) {
        repositoryOwner(login: $owner) {
          ... on ProjectV2Owner { projectV2(number: $number) { id } }
        }
      }`,
      { owner: this.owner, number: this.projectNumber(initiativeId) },
    );
    const projectId = repositoryOwner?.projectV2?.id;
    if (!projectId) throw this.initiativeNotFound(initiativeId);
    return projectId;
  }

  private async updateProjectReadme(
    projectId: string,
    readme: string,
    title?: string,
  ): Promise<void> {
    await this.gql(
      `mutation UpdateInitiative($projectId: ID!, $readme: String!, $title: String) {
        updateProjectV2(input: { projectId: $projectId, readme: $readme, title: $title }) {
          projectV2 { id }
        }
      }`,
      { projectId, readme, title: title ?? null },
    );
  }

  private async replaceIssueBody(
    id: string,
    role: string,
    input: { body: string; title?: string | undefined; labels?: string[] | undefined },
  ): Promise<void> {
    const issueNumber = parseInt(id, 10);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    // Preserve the entity-metadata block: re-splice the metadata carried on the
    // existing body into the new body via the same path create uses.
    const body = this.bodyMetadata.splice(input.body, this.bodyMetadata.parse(data.body ?? ""));
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.labels !== undefined
        ? { labels: this.mergeLabels(data.labels, role, input.labels) }
        : {}),
    });
  }

  /**
   * The label set to write on an edit: the caller's labels plus the role
   * (`epic`/`ticket`) and any `status:` label the issue already carries, so a
   * `--labels` edit replaces the free-form labels without dropping the ones the
   * factory manages.
   */
  private mergeLabels(current: OctokitIssueData["labels"], role: string, next: string[]): string[] {
    const preserved = new Set<string>([role]);
    for (const label of current) {
      const name = this.labelName(label);
      if (name.startsWith("status:")) preserved.add(name);
    }
    for (const name of next) preserved.add(name);
    return [...preserved];
  }

  private async resolveIssueId(issueNumber: number): Promise<number> {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    return data.id;
  }

  /**
   * Every `status:` label the repo defines, paginated so a repo with more than
   * one page of labels cannot silently omit some. The vocabulary is repo-wide,
   * which is why `listTransitions` ignores the ticket id it is handed.
   */
  private async statusLabelNames(): Promise<string[]> {
    const labels = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });
    return labels
      .map((label) => this.labelName(label))
      .filter((name) => name.startsWith("status:"));
  }

  private labelName(label: OctokitLabelData): string {
    if (typeof label === "string") return label;
    return label.name ?? "";
  }

  private mapComment(c: OctokitCommentData): Comment {
    return {
      id: String(c.id),
      body: c.body ?? "",
      author: c.user?.login ?? "",
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  private mapTicket(
    issue: OctokitIssueData,
    comments: OctokitCommentData[],
    blockedBy: string[] = [],
    blocking: string[] = [],
    metadata: EntityMetadata = {},
  ): Ticket {
    const labels = issue.labels.map((l) => this.labelName(l)).filter(Boolean);
    const statusLabel = labels.find((name) => name.startsWith("status:"));
    return {
      id: String(issue.number),
      size: "ticket",
      status: statusLabel !== undefined ? statusLabel.slice("status:".length) : issue.state,
      labels,
      title: issue.title,
      body: issue.body ?? "",
      comments: comments.map((c) => this.mapComment(c)),
      assignee: issue.assignee?.login ?? null,
      attachments: [],
      reporter: issue.user?.login ?? null,
      issueType: issue.type?.name ?? "Issue",
      blockedBy,
      blocking,
      metadata,
      updatedAt: issue.updated_at,
    };
  }
}
