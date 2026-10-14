import { readFileSync } from "node:fs";
import { Command } from "commander";
import { semanticTypes } from "../../semantic-types.js";
import { z } from "zod";
import { RegistryCommandOperationClient } from "../../../operations/command-operation-client.js";
import type { OperationRegistry } from "../../../operations/operation-registry.js";

// eslint-disable-next-line preflight/no-loose-functions -- collect is module-level behaviour awaiting a home on a service; tracked in KAN-39
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type GitCommitOptions = {
  type: string;
  scope: string;
  description: string;
  file: string[];
  body?: string;
  bodyFile?: string;
  footer: string[];
  model?: string;
};

type GitCheckoutOptions = {
  type: string;
  scope: string;
  description?: string;
  from?: string;
};

type GitPushOptions = {
  remote: string;
  setUpstream: boolean;
};

export function createGitCommand(registry: OperationRegistry): Command {
  const git = new Command("git");
  const operations = new RegistryCommandOperationClient({ registry });

  git
    .command("commit")
    .exitOverride()
    .requiredOption("--type <type>", "conventional commit type")
    .requiredOption("--scope <scope>", "conventional commit scope")
    .requiredOption("--description <description>", "commit description")
    .option(
      "--file <file>",
      "file to stage (repeatable); scopes the commit to exactly these paths. Omitting it commits the whole index",
      collect,
      [],
    )
    .option("--body <body>", "commit body (or use --body-file)")
    .option("--body-file <path>", "read the commit body from a file; wins over --body")
    .option("--footer <footer>", "commit footer (repeatable)", collect, [])
    .option("--model <model>", "model identifier")
    .action(async (opts: GitCommitOptions) => {
      const result = await operations.invoke(
        "git-commit",
        {
          type: opts.type,
          scope: opts.scope,
          description: opts.description,
          body: opts.bodyFile !== undefined ? readFileSync(opts.bodyFile, "utf8") : opts.body,
          footers: opts.footer,
          model: opts.model,
          files: opts.file,
        },
        z.object({ sha: z.string(), message: z.string() }),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  git
    .command("checkout")
    .exitOverride()
    .requiredOption("--type <type>", `branch type (${semanticTypes.join(" | ")})`)
    .requiredOption("--scope <scope>", "ticket number / scope")
    .option("--description <description>", "short readable slug")
    .option("--from <base>", "existing branch to base the new branch on (for stacking)")
    .action(async (opts: GitCheckoutOptions) => {
      const result = await operations.invoke(
        "git-checkout",
        {
          type: opts.type,
          scope: opts.scope,
          ...(opts.description === undefined ? {} : { description: opts.description }),
          ...(opts.from === undefined ? {} : { from: opts.from }),
        },
        z.object({
          branch: z.string(),
          from: z.string().nullable(),
          renamedFrom: z.string().nullable(),
        }),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  git
    .command("push")
    .exitOverride()
    .option("--remote <remote>", "remote to push to", "origin")
    .option("--no-set-upstream", "do not set the upstream tracking ref")
    .action(async (opts: GitPushOptions) => {
      const result = await operations.invoke(
        "git-push",
        { remote: opts.remote, setUpstream: opts.setUpstream },
        z.object({ branch: z.string(), remote: z.string(), setUpstream: z.boolean() }),
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    });

  return git;
}
