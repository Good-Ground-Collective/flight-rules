import { Command } from "commander";
import type { AriadnePackets } from "../../ariadne/ariadne-packets.js";
import type { OperationRegistry } from "../../../operations/operation-registry.js";
/** The packet was published but the file could not record its id. */
export declare class PacketIdWriteError extends Error {
    name: string;
}
/**
 * `flight-rules packet`: publishes and revises a Review Packet in Ariadne as
 * its author. Every failure throws, so the exit code is 1 and stderr carries a
 * one-line next step.
 */
export declare class PacketCommandFactory {
    create(getPackets: () => AriadnePackets, registry?: OperationRegistry): Command;
}
export declare const createPacketCommand: (getPackets: () => AriadnePackets, registry?: OperationRegistry) => Command;
