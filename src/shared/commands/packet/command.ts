import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { z } from "zod";
import type { AriadnePackets } from "../../ariadne/ariadne-packets.js";
import { packetIdGenerator } from "../../ariadne/packet-id-generator.js";
import { decimalIntegers } from "../../decimal-integer.js";

interface FileOptions {
  file: string;
}

interface UpdateOptions extends FileOptions {
  expectedRevision?: number;
}

/** Fields the server owns; `packet get` output carries them and an update must not send them back. */
const serverOwnedFields: ReadonlySet<string> = new Set(["id", "authorId", "status", "revision", "createdAt", "updatedAt"]);

const ReviewerEntrySchema = z.union([
  z.string(),
  z.looseObject({ github: z.looseObject({ login: z.string() }) }).transform((reviewer) => reviewer.github.login),
]);

/**
 * A packet file being revised, possibly the output of `packet get`: server-owned
 * fields are dropped and reviewers shown as `{id, github: {login}}` become the
 * logins an update sends.
 */
const UpdateFileSchema = z
  .looseObject({ id: z.string().optional(), revision: z.number().int().optional(), reviewers: z.array(ReviewerEntrySchema).optional() })
  .transform((file) => ({
    id: file.id,
    revision: file.revision,
    packet: {
      ...Object.fromEntries(Object.entries(file).filter(([key]) => !serverOwnedFields.has(key))),
      ...(file.reviewers !== undefined ? { reviewers: file.reviewers } : {}),
    },
  }));

/** The packet was published but the file could not record its id. */
export class PacketIdWriteError extends Error {
  override name = "PacketIdWriteError";
}

/** A JSON object with its keys in file order, so a write-back keeps the author's layout. */
const JsonObjectSchema = z.record(z.string(), z.unknown());

/** A packet JSON file. */
class PacketFile {
  constructor(private readonly path: string) {}

  /** The file's JSON exactly as written; strict validation happens before anything is sent. */
  read(): unknown {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (err) {
      throw new Error(`cannot read ${this.path}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${this.path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  /** Runs after the packet is stored, so a failure says so and names the id the file still needs. */
  writeId(file: Record<string, unknown>, id: string): void {
    try {
      writeFileSync(this.path, JSON.stringify({ ...file, id }, null, 2) + "\n");
    } catch (err) {
      throw new PacketIdWriteError(
        `packet ${id} was published, but its id could not be written to ${this.path}: ${err instanceof Error ? err.message : String(err)}; add "id": "${id}" to the file before re-running, or a re-run publishes a second packet`,
        { cause: err },
      );
    }
  }

  readForUpdate(): { id: string | undefined; packet: unknown; revision: number | undefined } {
    const parsed = UpdateFileSchema.safeParse(this.read());
    if (parsed.success) return parsed.data;
    throw new Error(
      `${this.path} must hold one packet object: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}`,
    );
  }
}

/**
 * `flight-rules packet`: publishes and revises a Review Packet in Ariadne as
 * its author. Every failure throws, so the exit code is 1 and stderr carries a
 * one-line next step.
 */
export class PacketCommandFactory {
  create(getPackets: () => AriadnePackets): Command {
    const packet = new Command("packet")
      .description("publish and revise a Review Packet in Ariadne, as its author")
      .addHelpText(
        "after",
        [
          "",
          "Token: $ARIADNE_AGENT_TOKEN, then $ARIADNE_TOKEN, then the file `board login` saves.",
          "Config: ariadne.url (https; http only for localhost), read only from user or local scope.",
          "A packet carries titles, annotations and anchors (path and line) only; code and diffs",
          "are rejected locally, as is over-long text. Every failure exits 1 with a next step.",
          "See docs/review-packets.md.",
        ].join("\n"),
      );
    packet.exitOverride();

    const print = (value: unknown): void => {
      process.stdout.write(JSON.stringify(value) + "\n");
    };

    packet
      .command("create")
      .description(
        "publish a packet from a JSON file; prints the stored packet. An id is generated from the title when the file has none, and the published id is written back into the file so a re-run replays instead of creating a second packet",
      )
      .requiredOption("--file <path>", "the packet JSON")
      .exitOverride()
      .action(async (opts: FileOptions) => {
        const packetFile = new PacketFile(opts.file);
        const input = packetFile.read();
        const published = await getPackets().create(input);
        print(published);
        const written = JsonObjectSchema.safeParse(input);
        if (written.success && written.data.id !== published.id) packetFile.writeId(written.data, published.id);
      });

    packet
      .command("new-id")
      .description('print {"id": "<slug>-<8 hex>"}: a globally unique packet id to write into the packet file once and reuse for every retry')
      .requiredOption("--title <title>", "the packet title")
      .exitOverride()
      .action((opts: { title: string }) => {
        print({ id: packetIdGenerator.generate(opts.title) });
      });

    packet
      .command("update")
      .description("revise a packet from a JSON file; a stale revision fails with 409 revision_conflict")
      .argument("<id>", "the packet id")
      .requiredOption("--file <path>", "the packet JSON; `packet get` output works, and its revision is used")
      .option(
        "--expected-revision <n>",
        "the revision you read, in decimal digits; defaults to the file's `revision`",
        (value: string) => decimalIntegers.nonNegative(value),
      )
      .exitOverride()
      .action(async (id: string, opts: UpdateOptions) => {
        const file = new PacketFile(opts.file).readForUpdate();
        if (file.id !== undefined && file.id !== id) {
          throw new Error(`${opts.file} holds packet ${file.id} but the command names ${id}; nothing was sent`);
        }
        const expectedRevision = opts.expectedRevision ?? file.revision;
        if (expectedRevision === undefined || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
          throw new Error(
            "no expected revision: pass --expected-revision <n>, or use a file with a numeric `revision` such as `flight-rules packet get` output; nothing was sent",
          );
        }
        print(await getPackets().update(id, { packet: file.packet, expectedRevision }));
      });

    packet
      .command("get")
      .description("print a packet, including its revision")
      .argument("<id>", "the packet id")
      .exitOverride()
      .action(async (id: string) => {
        print(await getPackets().get(id));
      });

    packet
      .command("reviewers")
      .description("list the Ariadne members you can name as reviewers: {id, name, github: {id, login}}")
      .exitOverride()
      .action(async () => {
        print(await getPackets().reviewers());
      });

    return packet;
  }
}

export const createPacketCommand = (getPackets: () => AriadnePackets): Command => new PacketCommandFactory().create(getPackets);
