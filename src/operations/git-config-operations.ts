import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { branchNamer } from "../git/branch-namer/branch-namer.js";
import { DefaultCommitMessageBuilder } from "../git/commit-message-builder/commit-message-builder.js";
import { CommitMessageInputSchema } from "../git/commit-message-builder/commit-message.schema.js";
import type { GitExecutor } from "../git/git-executor/git-executor.js";
import type { ConfigStore, ConfigScope } from "../shared/config-store.js";
import { configScopes } from "../shared/config-store.js";
import type { OperationEffect } from "./operation.schema.js";
import type { OperationDescriptor } from "./operation-registry.js";

export const ConfigScopeSchema = z.enum(configScopes);
const ConfigSetInputSchema = z
  .object({
    key: z.string().min(1),
    values: z.array(z.string()).min(1),
    scope: ConfigScopeSchema.optional(),
  })
  .strict();
const ConfigUnsetInputSchema = z
  .object({ key: z.string().min(1), scope: ConfigScopeSchema.optional() })
  .strict();
const GitCommitInputSchema = CommitMessageInputSchema.extend({
  files: z.array(z.string()).default([]),
}).strict();
const GitCheckoutInputSchema = z
  .object({
    type: z.string().min(1),
    scope: z.string().min(1),
    description: z.string().optional(),
    from: z.string().optional(),
  })
  .strict();
const GitPushInputSchema = z
  .object({ remote: z.string().min(1).default("origin"), setUpstream: z.boolean().default(true) })
  .strict();
const CommitMessageOutputSchema = z.object({ message: z.string() });
const BranchNameInputSchema = z
  .object({ type: z.string().min(1), scope: z.string().min(1), description: z.string().optional() })
  .strict();
const ConfigOperationPolicySchema = z
  .object({
    scopes: z.array(ConfigScopeSchema).default(["project", "local"]),
    roots: z.array(z.string().min(1)).default([]),
  })
  .strict();
const GitConfigOperationsPropsSchema = z.object({
  cwd: z.string().min(1),
  configStore: z.custom<ConfigStore>((value) => typeof value === "object" && value !== null),
  git: z.custom<GitExecutor>((value) => typeof value === "object" && value !== null),
  configPolicy: ConfigOperationPolicySchema.default({ scopes: ["project", "local"], roots: [] }),
  binPath: z.string().default(process.argv[1] ?? ""),
  agentEnv: z.string().optional(),
});

export interface ConfigOperationPolicy {
  scopes: ConfigScope[];
  roots: string[];
}

export interface GitConfigOperations {
  operations(): OperationDescriptor[];
}

export class LaunchConfigOperationDeniedError extends Error {
  override name = "LaunchConfigOperationDeniedError";
}

/** Shared config and git behavior bound to one checkout and its launch-time write policy. */
export class DefaultGitConfigOperations implements GitConfigOperations {
  private readonly props: z.infer<typeof GitConfigOperationsPropsSchema>;
  private readonly allowedScopes: Set<ConfigScope>;
  private readonly allowedRoots: string[];

  constructor(props: z.input<typeof GitConfigOperationsPropsSchema>) {
    this.props = GitConfigOperationsPropsSchema.parse(props);
    this.allowedScopes = new Set(this.props.configPolicy.scopes);
    const roots =
      this.props.configPolicy.roots.length === 0 ? [this.props.cwd] : this.props.configPolicy.roots;
    this.allowedRoots = [...new Set(roots)];
  }

  operations(): OperationDescriptor[] {
    return [
      this.descriptor(
        "config-set",
        "Set a value in an allowed configuration scope.",
        ["write", "process"],
        ["config", "set"],
        ConfigSetInputSchema,
        z.object({
          key: z.string(),
          scope: ConfigScopeSchema,
          path: z.string(),
          warning: z.string().optional(),
        }),
        (input) => this.setConfig(input),
      ),
      this.descriptor(
        "config-unset",
        "Remove a value from an allowed configuration scope.",
        ["write", "process"],
        ["config", "unset"],
        ConfigUnsetInputSchema,
        z.object({ key: z.string(), scope: ConfigScopeSchema, path: z.string() }),
        (input) => this.unsetConfig(input),
      ),
      this.descriptor(
        "git-commit",
        "Create a conventional commit in the launch checkout.",
        ["write", "process"],
        ["git", "commit"],
        GitCommitInputSchema,
        z.object({ sha: z.string(), message: z.string() }),
        (input) => this.commit(input),
      ),
      this.descriptor(
        "git-checkout",
        "Start a conventional branch in the launch checkout.",
        ["write", "process"],
        ["git", "checkout"],
        GitCheckoutInputSchema,
        z.object({
          branch: z.string(),
          from: z.string().nullable(),
          renamedFrom: z.string().nullable(),
        }),
        (input) => this.checkout(input),
      ),
      this.descriptor(
        "git-push",
        "Push the current branch from the launch checkout.",
        ["write", "network", "process"],
        ["git", "push"],
        GitPushInputSchema,
        z.object({ branch: z.string(), remote: z.string(), setUpstream: z.boolean() }),
        (input) => this.push(input),
      ),
      this.descriptor(
        "commit-message",
        "Build the conventional commit message without writing a file.",
        ["read", "process"],
        ["commit-message"],
        CommitMessageInputSchema,
        CommitMessageOutputSchema,
        (input) => ({ message: this.message(input) }),
      ),
      this.descriptor(
        "branch-name",
        "Build the conventional branch name without changing git state.",
        ["read", "process"],
        ["branch-name"],
        BranchNameInputSchema,
        z.object({ branch: z.string() }),
        (input) => ({
          branch: branchNamer.name({
            type: input.type,
            scope: input.scope,
            ...(input.description === undefined ? {} : { description: input.description }),
          }),
        }),
      ),
    ];
  }

  private descriptor<TInput, TOutput>(
    id: string,
    description: string,
    effects: OperationEffect[],
    path: string[],
    inputSchema: z.ZodType<TInput>,
    outputSchema: z.ZodType<TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): OperationDescriptor<TInput, TOutput> {
    return {
      id,
      description,
      effects,
      cli: { path, aliases: [] },
      inputSchema,
      outputSchema,
      handler,
    };
  }

  private setConfig(input: z.infer<typeof ConfigSetInputSchema>) {
    const scope = input.scope ?? this.props.configStore.defaultScopeFor(input.key);
    const path = this.authorizeConfigWrite(scope);
    this.props.configStore.set(input.key, input.values, scope);
    const shadowedBy = this.props.configStore.shadowingScope(input.key, scope);
    return {
      key: input.key,
      scope,
      path,
      ...(shadowedBy === undefined
        ? {}
        : {
            warning: `${input.key} is also set in ${shadowedBy} scope (${this.props.configStore.pathFor(shadowedBy)}), which takes precedence`,
          }),
    };
  }

  private unsetConfig(input: z.infer<typeof ConfigUnsetInputSchema>) {
    const scope = input.scope ?? this.props.configStore.defaultScopeFor(input.key);
    const path = this.authorizeConfigWrite(scope);
    this.props.configStore.unset(input.key, scope);
    return { key: input.key, scope, path };
  }

  private authorizeConfigWrite(scope: ConfigScope): string {
    if (!this.allowedScopes.has(scope))
      throw new LaunchConfigOperationDeniedError(
        `Configuration scope "${scope}" is not allowed by launch policy`,
      );
    const path = this.props.configStore.pathFor(scope);
    const absolutePath = isAbsolute(path) ? path : resolve(this.props.cwd, path);
    this.rejectDanglingSymlinks(absolutePath);
    let existingPath = existsSync(absolutePath) ? absolutePath : dirname(absolutePath);
    while (!existsSync(existingPath)) {
      const parent = dirname(existingPath);
      if (parent === existingPath)
        throw new LaunchConfigOperationDeniedError(
          `Configuration path has no existing parent: ${path}`,
        );
      existingPath = parent;
    }
    const resolvedExistingPath = realpathSync(existingPath);
    const target = existsSync(absolutePath)
      ? resolvedExistingPath
      : resolve(resolvedExistingPath, relative(existingPath, absolutePath));
    const authorizedRoots = this.allowedRoots.map((root) => realpathSync(root));
    if (
      !authorizedRoots.some((root) => {
        const rel = relative(root, target);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      })
    )
      throw new LaunchConfigOperationDeniedError(
        `Configuration path escapes launch roots: ${path}`,
      );
    return path;
  }

  private rejectDanglingSymlinks(path: string): void {
    const root = parse(path).root;
    let current = root;
    for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if (!lstatSync(current).isSymbolicLink()) continue;
      } catch {
        break;
      }
      try {
        realpathSync(current);
      } catch {
        throw new LaunchConfigOperationDeniedError(
          `Configuration path contains an unresolved symlink: ${path}`,
        );
      }
    }
  }

  private async commit(input: z.infer<typeof GitCommitInputSchema>) {
    const message = this.message(input);
    await this.props.git.stage(input.files);
    await this.props.git.commit(message, input.files);
    return { sha: await this.props.git.getCommitSha(), message };
  }

  private async checkout(input: z.infer<typeof GitCheckoutInputSchema>) {
    const result = await this.props.git.startBranch(
      {
        type: input.type,
        scope: input.scope,
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      input.from,
    );
    return { branch: result.branch, from: input.from ?? null, renamedFrom: result.renamedFrom };
  }

  private async push(input: z.infer<typeof GitPushInputSchema>) {
    const spec = {
      branch: await this.props.git.getCurrentBranch(),
      remote: input.remote,
      setUpstream: input.setUpstream,
    };
    await this.props.git.push(spec);
    return spec;
  }

  private message(input: z.infer<typeof CommitMessageInputSchema>): string {
    return new DefaultCommitMessageBuilder({
      binPath: this.props.binPath,
      agentEnv: this.props.agentEnv,
    }).build(input);
  }
}
