import { FileDocResolver, type DocResolver } from "../bundled-docs/doc-resolver/doc-resolver.js";
import { resolve } from "node:path";
import { NodeGitExecutor, type GitExecutor } from "../git/git-executor/git-executor.js";
import { GhPullRequestHost } from "../pr/pull-request-host/gh-pull-request-host.js";
import type { PullRequestHost } from "../pr/pull-request-host/pull-request-host.js";
import type { Config } from "../shared/config.js";
import { ConfigStore } from "../shared/config-store.js";
import {
  FileNativeInstallation,
  NativeHostSchema,
  type NativeHost,
  type NativeInstallation,
} from "../plugins/native-installation/native-installation.js";
import type { HostSettingsSource } from "../shared/host-settings/host-settings-source.js";
import { WorktreeLocator } from "../git/worktree-locator/worktree-locator.js";
import { EvidenceLocation } from "../tasks/evidence/evidence-location.js";
import { EnvLoader } from "../shared/env.js";
import { AriadneBoard } from "../shared/ariadne/ariadne-board.js";
import { AriadnePackets } from "../shared/ariadne/ariadne-packets.js";
import { AriadneTokenStore } from "../shared/ariadne/ariadne-token-store.js";
import { BoardAgentStore } from "../shared/ariadne/board-agent-store.js";
import { BoardSessionStore } from "../shared/ariadne/board-session-store.js";
import { GitHubTaskTracker } from "../tasks/github-task-tracker/github-task-tracker.js";
import { JiraTaskTracker } from "../tasks/jira-task-tracker/jira-task-tracker.js";
import type { TaskTracker } from "../tasks/task-tracker/task-tracker.js";
import { NodeToolProbe, type ToolProbe } from "../tasks/tool-probe/tool-probe.js";
import {
  NodeRepositoryReadiness,
  type RepositoryReadiness,
} from "../tasks/readiness/repository-readiness.js";
import { FlightRulesPropsSchema, type FlightRulesProps } from "./flight-rules.schema.js";
import {
  DefaultLocalDiscoveryOperations,
  type LocalDiscoveryOperations,
} from "../operations/local-discovery-operations.js";
import { DocCharterCatalog } from "../bundled-docs/charter-catalog/charter-catalog.js";
import { GitRepositoryPaths } from "../bundled-docs/charter-catalog/repository-paths.js";
import {
  DefaultGitConfigOperations,
  type ConfigOperationPolicy,
  type GitConfigOperations,
} from "../operations/git-config-operations.js";
import {
  DefaultReviewOperations,
  ReviewOperationsLaunchPropsSchema,
  type ReviewOperations,
  type ReviewOperationsLaunchProps,
} from "../operations/review-operations.js";
import { DefaultTrackerEntityOperations } from "../operations/tracker-entity-operations.js";
import type { TrackerEntityOperations } from "../operations/tracker-entity-operations.js";

export interface FlightRules {
  installation(): NativeInstallation;
  configPath(): string;
  configStore(): ConfigStore;
  /** The main checkout when the working directory is a linked git worktree. */
  mainCheckout(): string | undefined;
  evidence(): EvidenceLocation;
  config(overrideTracker?: string): Config;
  tracker(overrideTracker?: string): TaskTracker;
  prHost(overrideTracker?: string): PullRequestHost;
  git(): GitExecutor;
  probe(): ToolProbe;
  readiness(): RepositoryReadiness;
  docs(): DocResolver;
  localOperations(): LocalDiscoveryOperations;
  gitConfigOperations(policy?: ConfigOperationPolicy): GitConfigOperations;
  reviewOperations(props?: ReviewOperationsLaunchProps): ReviewOperations;
  trackerEntityOperations(): TrackerEntityOperations;
  /** Ariadne's Agents page reporter; reads only the `ariadne.*` keys from user and local scope, so it works without a valid tracker config. */
  board(): AriadneBoard;
  packets(): AriadnePackets;
  ariadneTokens(): AriadneTokenStore;
  /** The last heartbeat each session's skill posted, outside every repo; read by the heartbeat hook. */
  boardSessions(): BoardSessionStore;
  /** Which Jira ticket each sub-agent works on, outside every repo; written and read by the board hooks. */
  boardAgents(): BoardAgentStore;
}

/** Constructs services on demand so config and credentials are only required by their consumers. */
export class DefaultFlightRules implements FlightRules {
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly gitEnv: Record<string, string | undefined>;
  private readonly explicitConfigPath: string | undefined;
  private readonly hostSettings: HostSettingsSource | undefined;
  private readonly host: NativeHost | undefined;
  private readonly configWritePolicy: FlightRulesProps["configWritePolicy"];
  private untrackedRoot: { value: string | undefined } | undefined;

  constructor(props: FlightRulesProps = {}) {
    const parsed = FlightRulesPropsSchema.parse({
      ...props,
      env: props.env === undefined ? undefined : { ...props.env },
    });
    this.cwd = resolve(parsed.cwd ?? process.cwd());
    // Keep the validated input reference: Zod clones records, hiding later environment changes.
    this.env = props.env ?? process.env;
    this.gitEnv = { ...(props.env ?? process.env) };
    this.explicitConfigPath = parsed.configPath;
    this.hostSettings = props.hostSettings;
    this.host = parsed.host;
    this.configWritePolicy = parsed.configWritePolicy;
  }

  configPath(): string {
    return this.configStore().filePath();
  }

  configStore(): ConfigStore {
    // An explicit configPath acts as FLIGHT_RULES_CONFIG; otherwise the live env is passed through.
    const env =
      this.explicitConfigPath === undefined
        ? this.env
        : { ...this.env, FLIGHT_RULES_CONFIG: this.explicitConfigPath };
    const untrackedRoot = this.mainCheckout();
    return new ConfigStore({
      cwd: this.cwd,
      env,
      host: NativeHostSchema.parse(
        this.host ?? env["FLIGHT_RULES_HOST"] ?? this.installation().host() ?? "claude",
      ),
      ...(this.hostSettings !== undefined ? { hostSettings: this.hostSettings } : {}),
      ...(untrackedRoot !== undefined ? { untrackedRoot } : {}),
    });
  }

  installation(): NativeInstallation {
    return FileNativeInstallation.fromInstall({
      moduleUrl: import.meta.url,
      cwd: this.cwd,
      env: this.env,
    });
  }

  /** Looked up once per instance. */
  mainCheckout(): string | undefined {
    this.untrackedRoot ??= { value: new WorktreeLocator().mainCheckoutFor(this.cwd) };
    return this.untrackedRoot.value;
  }

  evidence(): EvidenceLocation {
    return new EvidenceLocation({ cwd: this.cwd, mainCheckout: this.mainCheckout() });
  }

  config(overrideTracker?: string): Config {
    const config = this.configStore().load();
    if (overrideTracker === undefined) return config;
    if (overrideTracker !== "github" && overrideTracker !== "jira") {
      throw new Error(`Invalid --tracker "${overrideTracker}" — expected "github" or "jira"`);
    }
    return { ...config, tracker: overrideTracker };
  }

  tracker(overrideTracker?: string): TaskTracker {
    const config = this.config(overrideTracker);
    const env = new EnvLoader().load(this.env);

    if (config.tracker === "github") {
      if (env.githubToken === undefined)
        throw new Error("GITHUB_TOKEN environment variable is required");
      if (config.repo === undefined) throw new Error("repo is required when tracker is github");

      const [owner, repo] = config.repo.split("/");
      if (owner === undefined || repo === undefined) {
        throw new Error(`Invalid repo format "${config.repo}" — expected "owner/repo"`);
      }

      return new GitHubTaskTracker({ token: env.githubToken, owner, repo });
    }

    if (env.jiraToken === undefined) {
      throw new Error(
        "JIRA_TOKEN (or JIRA_API_TOKEN / JIRA_API_KEY) environment variable is required",
      );
    }
    const email = env.jiraEmail ?? config.jiraEmail;
    if (email === undefined)
      throw new Error("JIRA_EMAIL environment variable or jiraEmail config is required");

    const host = env.jiraHost ?? config.jiraHost;
    if (host === undefined)
      throw new Error("JIRA_HOST environment variable or jiraHost config is required");
    if (config.jiraProject === undefined)
      throw new Error("jiraProject is required when tracker is jira");

    return new JiraTaskTracker({
      token: env.jiraToken,
      host,
      email,
      project: config.jiraProject,
      ...(config.jpdProject !== undefined ? { jpdProject: config.jpdProject } : {}),
      ...(config.confluenceSpaceKey !== undefined
        ? { confluenceSpaceKey: config.confluenceSpaceKey }
        : {}),
    });
  }

  prHost(overrideTracker?: string): PullRequestHost {
    const config = this.config(overrideTracker);

    if (config.repo === undefined) {
      throw new Error("repo (owner/repo) is required in config to create pull requests");
    }

    // gh authenticates itself from its own keyring or GH_TOKEN/GITHUB_TOKEN.
    return new GhPullRequestHost({ repo: config.repo });
  }

  git(): GitExecutor {
    return new NodeGitExecutor({ cwd: this.cwd, env: this.gitEnv });
  }

  gitConfigOperations(policy?: ConfigOperationPolicy): GitConfigOperations {
    return new DefaultGitConfigOperations({
      cwd: this.cwd,
      configStore: this.configStore(),
      git: this.git(),
      agentEnv: this.gitEnv["AI_AGENT"],
      configPolicy: policy ?? this.configWritePolicy,
    });
  }

  probe(): ToolProbe {
    return new NodeToolProbe({ cwd: this.cwd, env: this.env });
  }

  readiness(): RepositoryReadiness {
    return new NodeRepositoryReadiness({ cwd: this.cwd, env: this.env });
  }

  docs(): DocResolver {
    return FileDocResolver.fromInstall({ moduleUrl: import.meta.url, env: this.env });
  }

  localOperations(): LocalDiscoveryOperations {
    return new DefaultLocalDiscoveryOperations({
      cwd: this.cwd,
      getConfig: () => this.config(),
      getConfigStore: () => this.configStore(),
      getCharters: () => new DocCharterCatalog({ docs: this.docs() }),
      getRepositoryPaths: () => new GitRepositoryPaths({ cwd: this.cwd }),
      getEvidence: () => this.evidence(),
      getReadiness: () => this.readiness(),
      getProbe: () => this.probe(),
      getTracker: () => this.tracker(),
      getConfigPath: () => this.configPath(),
    });
  }

  reviewOperations(props: ReviewOperationsLaunchProps = {}): ReviewOperations {
    const launch = ReviewOperationsLaunchPropsSchema.parse(props);
    return new DefaultReviewOperations({
      ...launch,
      cwd: launch.cwd ?? this.cwd,
      env: this.env,
    });
  }

  trackerEntityOperations(): TrackerEntityOperations {
    return new DefaultTrackerEntityOperations({
      getTracker: () => this.tracker(),
      getPrHost: () => this.prHost(),
      getConfig: () => this.config(),
      cwd: this.cwd,
    });
  }

  board(): AriadneBoard {
    return new AriadneBoard({
      readLayers: () => this.configStore().layers(),
      tokens: this.ariadneTokens(),
      env: this.env,
      sessions: this.boardSessions(),
    });
  }

  packets(): AriadnePackets {
    return new AriadnePackets({
      readLayers: () => this.configStore().layers(),
      tokens: this.ariadneTokens(),
    });
  }

  ariadneTokens(): AriadneTokenStore {
    return new AriadneTokenStore({ env: this.env });
  }

  boardSessions(): BoardSessionStore {
    return new BoardSessionStore({ env: this.env });
  }

  boardAgents(): BoardAgentStore {
    return new BoardAgentStore({ env: this.env });
  }
}

export function createFlightRules(props: FlightRulesProps = {}): FlightRules {
  return new DefaultFlightRules(props);
}
