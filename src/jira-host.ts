// Users naturally set JIRA_HOST (or jiraHost in config) to a full URL like
// `https://acme.atlassian.net/`, but the API clients prepend the scheme
// themselves — a verbatim value would build `https://https://…//rest/api/3`.
// Reduce either form to a bare host on read.
export function normalizeJiraHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}
