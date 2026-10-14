import { basename } from "node:path/posix";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { TaskTracker } from "../../task-tracker/task-tracker.js";
import { DuplicateEvidenceNameError, TrackerEvidenceService } from "../evidence.js";

const makeTracker = (): TaskTracker => ({
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTicket: vi.fn(),
  getTicket: vi.fn(),
  linkTicketToEpic: vi.fn(),
  getTicketEpicId: vi.fn(),
  blockTicket: vi.fn(),
  unblockTicket: vi.fn(),
  transitionTicket: vi.fn(),
  listTransitions: vi.fn(),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  updateEpicMetadata: vi.fn(),
  updateTicketMetadata: vi.fn(),
  updateTddMetadata: vi.fn(),
  updateEpicDescription: vi.fn(),
  updateTicketDescription: vi.fn(),
  updateInitiativeDescription: vi.fn(),
  createTechnicalDesign: vi.fn(),
  createInitiative: vi.fn(),
  getInitiative: vi.fn(),
  linkEpicToInitiative: vi.fn(),
  getTechnicalDesign: vi.fn(),
  addComment: vi.fn(),
  addAttachment: vi.fn(async (_id: string, path: string) => ({
    id: "1",
    filename: basename(path),
    mimeType: "image/png",
    mediaUuid: `uuid-${basename(path)}`,
  })),
  getUsers: vi.fn(),
  ping: vi.fn(),
});

describe("TrackerEvidenceService", () => {
  it("matches relative and symlink specs to the same absolute real file before and after upload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fr-evidence-"));
    try {
      const root = realpathSync(directory);
      const image = join(root, "proof.png");
      const alias = join(root, "alias.png");
      writeFileSync(image, "image");
      symlinkSync(image, alias);

      for (const spec of [relative(process.cwd(), image), relative(process.cwd(), alias)]) {
        const tracker = makeTracker();
        const service = new TrackerEvidenceService({ tracker });
        const body = `![Proof](${image})`;
        const expected = `![Proof](attachment:${basename(spec)})`;
        expect(service.prepareBody({ body, specs: [spec] })).toBe(expected);
        expect(tracker.addAttachment).not.toHaveBeenCalled();
        const result = await service.attach({ ticketId: "PROJ-1", body, specs: [spec] });
        expect(result.body).toBe(expected);
        expect(result.attachments[0]?.referenced).toBe(true);
        expect(tracker.addAttachment).toHaveBeenCalledExactlyOnceWith("PROJ-1", spec);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps an unrelated absolute file with the same basename out of the rewrite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fr-evidence-"));
    const outside = mkdtempSync(join(tmpdir(), "fr-evidence-outside-"));
    try {
      const image = join(realpathSync(directory), "proof.png");
      const unrelated = join(realpathSync(outside), "proof.png");
      writeFileSync(image, "image");
      writeFileSync(unrelated, "unrelated");
      const service = new TrackerEvidenceService({ tracker: makeTracker() });
      const body = `![Unrelated](${unrelated})`;
      const specs = [relative(process.cwd(), image)];
      const expected = `${body}\n\n![proof.png](attachment:proof.png)`;
      expect(service.prepareBody({ body, specs })).toBe(expected);
      const result = await service.attach({ ticketId: "PROJ-1", body, specs });
      expect(result.body).toBe(expected);
      expect(result.attachments[0]?.referenced).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("defaults an unreferenced caption to the basename and appends after a blank line", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "See below.",
      specs: ["./after.png"],
    });
    expect(body).toBe("See below.\n\n![after.png](attachment:after.png)");
    expect(attachments[0]?.caption).toBe("after.png");
    expect(attachments[0]?.referenced).toBe(false);
  });

  it("uses the #caption only on appended refs and keeps an in-body ref alt text", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "![Login error](./before.png)",
      specs: ["./before.png#Before", "./after.png"],
    });
    expect(body).toBe(
      "![Login error](attachment:before.png)\n\n![after.png](attachment:after.png)",
    );
    expect(attachments[0]?.referenced).toBe(true);
    expect(attachments[1]?.referenced).toBe(false);
  });

  it("uploads every spec before rewriting the body", async () => {
    const tracker = makeTracker();
    await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "![x](./before.png)",
      specs: ["./before.png#Before", "./after.png"],
    });
    expect(tracker.addAttachment).toHaveBeenCalledWith("PROJ-1", "./before.png");
    expect(tracker.addAttachment).toHaveBeenCalledWith("PROJ-1", "./after.png");
  });

  it("resolves ./before.png and before.png and evidence/before.png to one attachment by basename", async () => {
    const tracker = makeTracker();
    const cases = [
      { ref: "./before.png", spec: "./before.png" },
      { ref: "before.png", spec: "before.png" },
      { ref: "evidence/before.png", spec: "./before.png" },
    ];
    for (const { ref, spec } of cases) {
      const { body } = await new TrackerEvidenceService({ tracker }).attach({
        ticketId: "PROJ-1",
        body: `![alt](${ref})`,
        specs: [spec],
      });
      expect(body).toBe("![alt](attachment:before.png)");
    }
  });

  it("rewrites a plain [text](./clip.webm) link without gaining a bang", async () => {
    const tracker = makeTracker();
    const { body } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "[watch the clip](./clip.webm)",
      specs: ["./clip.webm"],
    });
    expect(body).toBe("[watch the clip](attachment:clip.webm)");
  });

  it("leaves references inside a fenced code block untouched", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "```md\n![x](./before.png)\n```",
      specs: ["./before.png"],
    });
    expect(body).toBe("```md\n![x](./before.png)\n```\n\n![before.png](attachment:before.png)");
    expect(attachments[0]?.referenced).toBe(false);
  });

  it("leaves a reference inside a tilde fence untouched", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "~~~\n![x](./a.png)\n~~~",
      specs: ["./a.png"],
    });
    expect(body).toBe("~~~\n![x](./a.png)\n~~~\n\n![a.png](attachment:a.png)");
    expect(attachments[0]?.referenced).toBe(false);
  });

  it("keeps an inner ``` line from closing an outer four-backtick fence", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "````\n```\n![x](./b.png)\n````",
      specs: ["./b.png"],
    });
    expect(body).toBe("````\n```\n![x](./b.png)\n````\n\n![b.png](attachment:b.png)");
    expect(attachments[0]?.referenced).toBe(false);
  });

  it("rewrites a reference outside any fence", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "Before the fence ![x](./c.png)\n~~~\ncode\n~~~",
      specs: ["./c.png"],
    });
    expect(body).toBe("Before the fence ![x](attachment:c.png)\n~~~\ncode\n~~~");
    expect(attachments[0]?.referenced).toBe(true);
  });

  it("is idempotent for an already-attachment body", async () => {
    const tracker = makeTracker();
    const { body, attachments } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "![x](attachment:before.png)",
      specs: ["./before.png"],
    });
    expect(body).toBe("![x](attachment:before.png)\n\n![before.png](attachment:before.png)");
    expect(attachments[0]?.referenced).toBe(false);
  });

  it("leaves https targets untouched", async () => {
    const tracker = makeTracker();
    const { body } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "![x](https://example.com/before.png)",
      specs: ["./before.png"],
    });
    expect(body).toBe(
      "![x](https://example.com/before.png)\n\n![before.png](attachment:before.png)",
    );
  });

  it("appends unreferenced files in flag order", async () => {
    const tracker = makeTracker();
    const { body } = await new TrackerEvidenceService({ tracker }).attach({
      ticketId: "PROJ-1",
      body: "top",
      specs: ["./one.png#First", "./two.png#Second"],
    });
    expect(body).toBe("top\n\n![First](attachment:one.png)\n\n![Second](attachment:two.png)");
  });

  it("rejects two specs with the same basename before uploading anything", async () => {
    const tracker = makeTracker();
    await expect(
      new TrackerEvidenceService({ tracker }).attach({
        ticketId: "PROJ-1",
        body: "x",
        specs: ["a/before.png", "b/before.png"],
      }),
    ).rejects.toBeInstanceOf(DuplicateEvidenceNameError);
    await expect(
      new TrackerEvidenceService({ tracker }).attach({
        ticketId: "PROJ-1",
        body: "x",
        specs: ["a/before.png", "b/before.png"],
      }),
    ).rejects.toThrow(/a\/before\.png.*b\/before\.png/);
    expect(tracker.addAttachment).not.toHaveBeenCalled();
  });

  it("propagates an addAttachment rejection", async () => {
    const tracker = makeTracker();
    vi.mocked(tracker.addAttachment).mockRejectedValue(new Error("upload failed"));
    await expect(
      new TrackerEvidenceService({ tracker }).attach({
        ticketId: "PROJ-1",
        body: "![x](./before.png)",
        specs: ["./before.png"],
      }),
    ).rejects.toThrow("upload failed");
  });
});
