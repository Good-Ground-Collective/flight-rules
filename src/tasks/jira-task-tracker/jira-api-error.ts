export class JiraApiError extends Error {
  readonly status: number
  readonly messages: string[]
  readonly fieldErrors: Record<string, string>

  constructor(status: number, messages: string[], fieldErrors: Record<string, string>) {
    super(messages[0] ?? `Jira API error (status ${status})`)
    this.name = 'JiraApiError'
    this.status = status
    this.messages = messages
    this.fieldErrors = fieldErrors
  }
}
