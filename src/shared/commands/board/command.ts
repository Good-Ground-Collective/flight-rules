import { createInterface } from "node:readline";
import { text } from "node:stream/consumers";
import { Writable } from "node:stream";
import { Command, Option } from "commander";
import { collect } from "../../collect.js";
import type { AriadneBoard, BoardOutcome } from "../../ariadne/ariadne-board.js";
import { agentActivityLevels, agentItemKinds, agentStates } from "../../ariadne/ariadne.schema.js";
import type { AgentActivityLevel, AgentItem, AgentItemKind, AgentState } from "../../ariadne/ariadne.schema.js";
import { AriadneTokenStore } from "../../ariadne/ariadne-token-store.js";

interface ReportOptions {
  session?: string;
  strict?: boolean;
  json?: boolean;
}

interface HeartbeatOptions extends ReportOptions {
  ticket: string;
  step: string;
  state: AgentState;
  branch?: string;
  repo?: string;
  skill?: string;
  detail?: string;
}

interface ItemOptions extends ReportOptions {
  kind: AgentItemKind;
  ticket: string;
  title: string;
  detail?: string;
  option: string[];
  id?: string;
}

interface ActivityOptions extends ReportOptions {
  ticket: string;
  text: string;
  level?: AgentActivityLevel;
  id?: string;
}

/** Reads a secret from piped stdin, or prompts on a terminal without echoing what is typed. */
export class HiddenPrompt {
  async read(label: string): Promise<string> {
    if (process.stdin.isTTY !== true) return text(process.stdin);
    process.stderr.write(label);
    const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
    const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
    try {
      return await new Promise<string>((resolve) => prompt.once("line", resolve));
    } finally {
      prompt.close();
      process.stderr.write("\n");
    }
  }
}

const ticketHelp = "Jira issue key";
const sessionHelp = "session id; defaults to the Claude Code session ($CLAUDE_CODE_SESSION_ID)";
const strictHelp = "exit 1 when the post fails, and post even without a token so a missing one fails with 401";

/**
 * `flight-rules board`: reports this run to Ariadne's Agents page. Not
 * configured or disabled, every subcommand prints nothing and exits 0. A
 * failure is one stderr line and exit 0, or exit 1 under `--strict`.
 */
export function createBoardCommand(
  getBoard: () => AriadneBoard,
  getTokens: () => AriadneTokenStore = () => new AriadneTokenStore(),
  readSecret: () => Promise<string> = () => new HiddenPrompt().read("Ariadne agent token: "),
): Command {
  const board = new Command("board")
    .description("report this run to Ariadne's Agents page (opt-in; silent unless an Ariadne token is set)")
    .addHelpText(
      "after",
      [
        "",
        "Token: $ARIADNE_AGENT_TOKEN, then $ARIADNE_TOKEN, then the file `board login` saves.",
        "There is no fallback to the ariadne CLI's Keychain session, so each machine needs its",
        "own agent token from Ariadne › Settings › Connections.",
        "Config: ariadne.url (https; http only for localhost) and ariadne.enabled, read only from",
        "user or local scope; project settings and the config file cannot set them.",
        "Not configured or disabled: prints nothing, exits 0. A failure is one stderr line and",
        "exit 0; --strict makes it exit 1. `board items` is read-only; answer items in Ariadne.",
      ].join("\n"),
    );
  board.exitOverride();

  const withReportOptions = (command: Command, jsonHelp: string): Command =>
    command
      .option("--session <id>", sessionHelp)
      .option("--strict", strictHelp)
      .option("--json", jsonHelp)
      .exitOverride();

  /**
   * Notices about ignored config are diagnostics: printed under --strict and
   * by `board items`, never on the quiet path a hook uses.
   */
  const finish = <T>(
    outcome: BoardOutcome<T>,
    opts: ReportOptions,
    print: (value: T) => void,
    loud: boolean = opts.strict === true,
  ): void => {
    if (loud) for (const notice of outcome.notices ?? []) process.stderr.write(`flight-rules board: ${notice}\n`);
    if (outcome.status === "skipped") return;
    if (outcome.status === "failed") {
      if (opts.strict === true) throw new Error(`flight-rules board: ${outcome.message}`);
      process.stderr.write(`flight-rules board: ${outcome.message}\n`);
      return;
    }
    print(outcome.value);
  };

  const printJson =
    (opts: ReportOptions) =>
    (value: unknown): void => {
      if (opts.json === true) process.stdout.write(JSON.stringify(value) + "\n");
    };

  const describeItem = (item: AgentItem): string => {
    const answer =
      item.chosenOption !== null
        ? ` -> ${item.chosenOption}`
        : item.options.length > 0
          ? ` [${item.options.join(" | ")}]`
          : "";
    return `${item.status}\t${item.kind}\t${item.ticket ?? "-"}\t${item.id}\t${item.title}${answer}`;
  };

  const post = new Command("post").description("send a heartbeat, an item that needs a person, or an activity line");
  post.exitOverride();

  withReportOptions(
    post
      .command("heartbeat")
      .description("create or update this session: ticket, step and state")
      .requiredOption("--ticket <key>", ticketHelp)
      .requiredOption("--step <step>", "one line up to 60 characters: implement, verify 2/3, pr, qa")
      .addOption(new Option("--state <state>", "how the run is going").choices(agentStates).makeOptionMandatory())
      .option("--branch <branch>", "the branch as git prints it")
      .option("--repo <repo>", "owner/name")
      .option("--skill <skill>", "the skill reporting, e.g. flight-rules:execute-work")
      .option("--detail <line>", "one line up to 500 characters"),
    "print the API response {session} as JSON",
  ).action(async (opts: HeartbeatOptions) => {
    const outcome = await getBoard().heartbeat(
      {
        session: opts.session,
        ticket: opts.ticket,
        step: opts.step,
        state: opts.state,
        branch: opts.branch,
        repo: opts.repo,
        skill: opts.skill,
        detail: opts.detail,
      },
      { strict: opts.strict === true },
    );
    finish(outcome, opts, printJson(opts));
  });

  withReportOptions(
    post
      .command("item")
      .description("ask a person for something: a question, blocker, testable or wave gate, with up to 6 options")
      .addOption(new Option("--kind <kind>", "what the person is asked for").choices(agentItemKinds).makeOptionMandatory())
      .requiredOption("--ticket <key>", ticketHelp)
      .requiredOption("--title <text>", "one line up to 200 characters")
      .option("--detail <text>", "up to 2,000 characters; line breaks allowed")
      .option("--option <label>", "an answer the person can choose (repeatable, up to 6)", collect, [])
      .option("--id <id>", "client id; reposting the same id returns the stored item and its chosenOption"),
    "print the API response {item, created} as JSON, including any chosenOption",
  ).action(async (opts: ItemOptions) => {
    const outcome = await getBoard().item(
      {
        session: opts.session,
        kind: opts.kind,
        ticket: opts.ticket,
        title: opts.title,
        detail: opts.detail,
        ...(opts.option.length > 0 ? { options: opts.option } : {}),
        id: opts.id,
      },
      { strict: opts.strict === true },
    );
    finish(outcome, opts, printJson(opts));
  });

  withReportOptions(
    post
      .command("activity")
      .description("add one line to the session's activity stream")
      .requiredOption("--ticket <key>", ticketHelp)
      .requiredOption("--text <line>", "one line up to 500 characters")
      .addOption(new Option("--level <level>", "defaults to info").choices(agentActivityLevels))
      .option("--id <id>", "client id; reposting the same id stores nothing new"),
    "print the API response {activity, created} as JSON",
  ).action(async (opts: ActivityOptions) => {
    const outcome = await getBoard().activity(
      { session: opts.session, ticket: opts.ticket, text: opts.text, level: opts.level, id: opts.id },
      { strict: opts.strict === true },
    );
    finish(outcome, opts, printJson(opts));
  });

  board.addCommand(post);

  withReportOptions(
    board.command("items").description("list a session's items, open and resolved, with any chosen option"),
    "print {items} as JSON",
  ).action(async (opts: ReportOptions) => {
    const outcome = await getBoard().items(opts.session, { strict: opts.strict === true });
    finish(
      outcome,
      opts,
      ({ items }) => {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ items }) + "\n");
          return;
        }
        process.stdout.write(items.map((item) => describeItem(item) + "\n").join(""));
      },
      true,
    );
  });

  board
    .command("login")
    .description(
      "save this machine's Ariadne agent token (each machine needs its own, from Ariadne › Settings › Connections), read from stdin or a hidden prompt, with mode 0600",
    )
    .exitOverride()
    .action(async () => {
      const tokens = getTokens();
      const path = tokens.save(await readSecret());
      const shadowedBy = tokens.shadowingEnv();
      process.stdout.write(
        JSON.stringify({
          saved: path,
          ...(shadowedBy !== undefined
            ? { warning: `$${shadowedBy} is set and takes precedence over the saved token` }
            : {}),
        }) + "\n",
      );
    });

  board
    .command("logout")
    .description("delete the agent token saved by `board login`")
    .exitOverride()
    .action(() => {
      const tokens = getTokens();
      process.stdout.write(JSON.stringify({ removed: tokens.remove(), path: tokens.path() }) + "\n");
    });

  return board;
}
