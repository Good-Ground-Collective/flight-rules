import { Command } from "commander";
import { z } from "zod";
import { collect } from "../../../shared/collect.js";
import { decimalIntegers } from "../../../shared/decimal-integer.js";
import {
  OperationCliError,
  OperationInputError,
  type OperationRegistry,
} from "../../../operations/operation-registry.js";
import type { OperationEnvelope } from "../../../operations/operation.schema.js";
import { resolveBody } from "../../../tasks/commands/resolve-body.js";

const propsSchema = z.strictObject({
  registry: z.custom<OperationRegistry>(
    (value) => typeof value === "object" && value !== null && "invoke" in value,
  ),
});

type CreateOptions = {
  type: string;
  scope: string;
  description: string;
  why: string;
  what: string[];
  ots?: string;
  base: string;
  head: string;
  ticketId?: string;
  ticketUrl?: string;
  reviewer: string[];
  label: string[];
  attach: string[];
};

type CommentOptions = { body?: string; bodyFile?: string; attach: string[] };

export interface PrCommandAdapter {
  create(): Command;
}

/** Keeps Commander parsing at the edge and delegates validated PR behavior to the shared registry. */
export class CommanderPrCommand implements PrCommandAdapter {
  private readonly registry: OperationRegistry;

  constructor(props: z.input<typeof propsSchema>) {
    this.registry = propsSchema.parse(props).registry;
  }

  create(): Command {
    const pr = new Command("pr");
    pr.command("create")
      .exitOverride()
      .requiredOption("--type <type>", "conventional commit type")
      .requiredOption("--scope <scope>", "conventional commit scope")
      .requiredOption("--description <description>", "PR title description")
      .requiredOption("--why <why>", 'the "Why Was It Changed" prose section')
      .requiredOption("--what <what>", 'a "What Was Changed" bullet (repeatable, 1-5)', collect, [])
      .requiredOption("--base <base>", "base branch to merge into")
      .requiredOption("--head <head>", "head branch to merge from")
      .option("--ots <markdown>", 'the "OTS Materials" block (raw markdown/JSON)')
      .option("--ticket-id <id>", "tracker ticket id")
      .option("--ticket-url <url>", "tracker ticket url")
      .option("--reviewer <reviewer>", "reviewer to request (repeatable)", collect, [])
      .option("--label <label>", "label to apply (repeatable)", collect, [])
      .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
      .action(async (opts: CreateOptions, command: Command) => {
        await this.invokeAndPrint("pr-create", {
          type: opts.type,
          scope: opts.scope,
          description: opts.description,
          why: opts.why,
          what: opts.what,
          ...(opts.ots === undefined ? {} : { ots: opts.ots }),
          base: opts.base,
          head: opts.head,
          ...(opts.ticketId === undefined ? {} : { ticketId: opts.ticketId }),
          ...(opts.ticketUrl === undefined ? {} : { ticketUrl: opts.ticketUrl }),
          reviewer: opts.reviewer,
          label: opts.label,
          attach: opts.attach,
        }, command);
      });

    pr.command("comment")
      .exitOverride()
      .argument("<number>", "pull request number", (value: string) => decimalIntegers.positive(value))
      .option("--body <body>", "comment body (or use --body-file)")
      .option("--body-file <path>", "read the comment body from a file")
      .option("--attach <spec>", "file to attach, as <path>#<caption> (repeatable)", collect, [])
      .action(async (number: number, opts: CommentOptions, command: Command) => {
        const body = resolveBody({ body: opts.body, bodyFile: opts.bodyFile });
        await this.invokeAndPrint("pr-comment", { number, body, attach: opts.attach }, command);
      });

    pr.command("list")
      .exitOverride()
      .option("--ticket <id>", "ticket id (repeatable, required)", collect, [])
      .action(async (opts: { ticket: string[] }, command: Command) => {
        await this.invokeAndPrint("pr-list", { ticket: opts.ticket }, command);
      });

    pr.command("request-review")
      .exitOverride()
      .argument("<number>", "pull request number", (value: string) => decimalIntegers.positive(value))
      .option("--reviewer <login>", "reviewer to request (repeatable, required)", collect, [])
      .action(async (number: number, opts: { reviewer: string[] }, command: Command) => {
        await this.invokeAndPrint("pr-request-review", { number, reviewer: opts.reviewer }, command);
      });

    return pr;
  }

  private async invokeAndPrint(id: string, input: unknown, command: Command): Promise<void> {
    let envelope: OperationEnvelope;
    try {
      envelope = await this.registry.invoke(id, input);
    } catch (error) {
      if (error instanceof OperationInputError) command.error(error.message);
      throw error;
    }
    if (envelope.status === "error") {
      if (envelope.error.name === "OperationInputError") command.error(envelope.error.message);
      throw new OperationCliError({
        operationId: id,
        errorName: envelope.error.name,
        message: envelope.error.message,
      });
    }
    process.stdout.write(`${JSON.stringify(envelope.data)}\n`);
    if (envelope.status === "partial") {
      throw new OperationCliError({
        operationId: id,
        errorName: envelope.error.name,
        message: envelope.error.message,
      });
    }
  }
}

export function createPrCommand(registry: OperationRegistry): Command {
  return new CommanderPrCommand({ registry }).create();
}
