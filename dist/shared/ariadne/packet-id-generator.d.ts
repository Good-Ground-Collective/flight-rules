/** Makes the ids Review Packets are published under; ids are unique across every author, so each carries a random suffix. */
export interface PacketIdGenerator {
    /** `<kebab-slug-of-title>-<8 hex>`; the slug is at most 60 characters. */
    generate(title: string): string;
    /** The same slug with a new random suffix, for when the id was already taken. */
    regenerate(id: string): string;
}
export declare class RandomPacketIdGenerator implements PacketIdGenerator {
    generate(title: string): string;
    regenerate(id: string): string;
    private slug;
    private trim;
    private suffix;
}
export declare const packetIdGenerator: PacketIdGenerator;
