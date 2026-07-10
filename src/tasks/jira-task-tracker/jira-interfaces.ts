import type { AdfDocNode } from './adf.js'

/** Construction contract for {@link JiraTaskTracker}. */
export interface JiraTrackerConfig {
  token: string
  host: string
  email: string
  project: string
  jpdProject?: string
}

export interface JiraAssignableUser {
  accountId: string
  displayName: string
}

export interface JiraCreatedIssue {
  id: string
  key: string
}

export interface JiraIssueLink {
  id?: string
  type: { name: string }
  inwardIssue?: { key: string }
  outwardIssue?: { key: string }
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

export interface JiraIssue {
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

export interface JiraSearchResponse {
  issues: JiraIssue[]
}

export interface JiraIssueTypesResponse {
  values: { id: string; name: string }[]
}

export interface JiraComment {
  id: string
  author?: { displayName?: string }
  created: string
  updated: string
}
