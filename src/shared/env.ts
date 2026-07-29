import { z } from "zod";
import { JiraHostSchema } from "../tasks/jira-task-tracker/jira-host.js";

const EnvSchema = z.object({
  githubToken: z.string().optional(),
  jiraToken: z.string().optional(),
  jiraEmail: z.string().optional(),
  jiraHost: JiraHostSchema.optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvLoader {
  private readonly overrides: Partial<Env>;
  private cachedEnv: Env | null = null;

  constructor(overrides: Partial<Env> = {}) {
    this.overrides = overrides;
  }

  public load(
    source: Record<string, unknown> = process.env,
    forceRefresh: boolean = false,
  ): Env {
    if (!forceRefresh && this.cachedEnv) return this.cachedEnv;

    this.cachedEnv = EnvSchema.parse({
      githubToken: source["GITHUB_TOKEN"],
      jiraToken:
        source["JIRA_TOKEN"] ??
        source["JIRA_API_TOKEN"] ??
        source["JIRA_API_KEY"],
      jiraEmail: source["JIRA_EMAIL"],
      jiraHost: source["JIRA_HOST"],
    });

    this.cachedEnv = {
      ...this.cachedEnv,
      ...this.overrides,
    };

    return this.cachedEnv;
  }
}
