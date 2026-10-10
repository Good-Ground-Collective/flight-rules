import { randomBytes } from "node:crypto";

/** Makes the ids Review Packets are published under; ids are unique across every author, so each carries a random suffix. */
export interface PacketIdGenerator {
  /** `<kebab-slug-of-title>-<8 hex>`; the slug is at most 60 characters. */
  generate(title: string): string;
  /** The same slug with a new random suffix, for when the id was already taken. */
  regenerate(id: string): string;
}

const maxSlugLength = 60;
const fallbackSlug = "packet";
const suffixPattern = /-[0-9a-f]{8}$/;

export class RandomPacketIdGenerator implements PacketIdGenerator {
  generate(title: string): string {
    return `${this.slug(title)}-${this.suffix()}`;
  }

  regenerate(id: string): string {
    const slug = this.trim(id.replace(suffixPattern, ""));
    const previous = id.slice(-8);
    let suffix = this.suffix();
    while (suffix === previous) suffix = this.suffix();
    return `${slug === "" ? fallbackSlug : slug}-${suffix}`;
  }

  private slug(title: string): string {
    const kebab = this.trim(title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    return kebab === "" ? fallbackSlug : kebab;
  }

  private trim(text: string): string {
    return text.slice(0, maxSlugLength).replace(/^-+|-+$/g, "");
  }

  private suffix(): string {
    return randomBytes(4).toString("hex");
  }
}

export const packetIdGenerator: PacketIdGenerator = new RandomPacketIdGenerator();
