import { describe, expect, it } from "vitest";
import { PacketIdSchema } from "../review-packet.schema.js";
import { packetIdGenerator } from "../packet-id-generator.js";

describe("RandomPacketIdGenerator", () => {
  it("slugs a normal title and adds 8 lowercase hex", () => {
    expect(packetIdGenerator.generate("Checkout rewrite, wave 2")).toMatch(
      /^checkout-rewrite-wave-2-[0-9a-f]{8}$/,
    );
  });

  it("truncates a long title to 60 characters without a trailing hyphen", () => {
    const id = packetIdGenerator.generate(`${"a".repeat(59)} bbbb`);
    expect(id).toMatch(/^a{59}-[0-9a-f]{8}$/);
    expect(id.length).toBeLessThanOrEqual(80);
    expect(packetIdGenerator.generate("x".repeat(200))).toMatch(/^x{60}-[0-9a-f]{8}$/);
  });

  it("collapses punctuation and unicode runs and trims the ends", () => {
    expect(packetIdGenerator.generate("  --Ünïcode!!  &  café ☕  ")).toMatch(
      /^n-code-caf-[0-9a-f]{8}$/,
    );
  });

  it("falls back to a fixed word when nothing is usable", () => {
    expect(packetIdGenerator.generate("☕ !!!")).toMatch(/^packet-[0-9a-f]{8}$/);
    expect(packetIdGenerator.generate("")).toMatch(/^packet-[0-9a-f]{8}$/);
  });

  it("always produces an id the packet schema accepts", () => {
    for (const title of ["x".repeat(200), "☕", "A b", "a-".repeat(80)]) {
      expect(PacketIdSchema.safeParse(packetIdGenerator.generate(title)).success).toBe(true);
    }
  });

  it("regenerates only the suffix", () => {
    const id = packetIdGenerator.generate("Wave two");
    const again = packetIdGenerator.regenerate(id);
    expect(again).toMatch(/^wave-two-[0-9a-f]{8}$/);
    expect(again).not.toBe(id);
  });

  it("regenerates a file-supplied id that has no suffix by appending one", () => {
    expect(packetIdGenerator.regenerate("my_packet")).toMatch(/^my_packet-[0-9a-f]{8}$/);
  });
});
