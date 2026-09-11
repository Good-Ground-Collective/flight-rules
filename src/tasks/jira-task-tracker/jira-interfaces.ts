import type { AdfDocNode } from './adf.js'

/** Construction contract for {@link JiraTaskTracker}. */
export interface JiraTrackerConfig {
  token: string
  host: string
  email: string
  project: string
  jpdProject?: string
  confluenceSpaceKey?: string
}

export interface JiraAssignableUser {
  accountId: string
  displayName: string
}

export interface JiraCreatedIssue {
  id: string
  key: string
}

export interface JiraProject {
  projectTypeKey: string
}

export interface JiraIssueLink {
  id?: string
  type: { name: string }
  inwardIssue?: { key: string }
  outwardIssue?: { key: string }
}

export interface JiraAttachment {
  id: string
  filename?: string
  mimeType?: string
  size?: number
  content?: string
}

export interface JiraLinkType {
  id: string
  name: string
  inward: string
  outward: string
}

export interface JiraIssueLinkTypesResponse {
  issueLinkTypes: JiraLinkType[]
}

export interface JiraTransition {
  id: string
  name: string
  to: { name: string }
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[]
}

export interface JiraIssue {
  id: string
  key: string
  fields: {
    summary: string
    status?: { name: string }
    labels?: string[]
    assignee?: { accountId: string } | null
    reporter?: { accountId: string; displayName?: string } | null
    issuetype?: { name: string; id?: string }
    attachment?: JiraAttachment[]
    description?: AdfDocNode | null
    updated?: string
    parent?: { key: string }
    issuelinks?: JiraIssueLink[]
  }
}

export interface JiraSearchResponse {
  issues: JiraIssue[]
}

export interface JiraIssueTypesResponse {
  issueTypes: { id: string; name: string }[]
}

export interface JiraComment {
  id: string
  author?: { displayName?: string }
  created: string
  updated: string
}
