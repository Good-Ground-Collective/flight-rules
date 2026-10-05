import { Command } from "commander";
import type { Config } from "../../../shared/config.js";
import { QaInstructionsFinder } from "../../qa-instructions/qa-instructions.js";
import type { EvidenceLocation } from "../../evidence/evidence-location.js";
export declare function createQaCommand(getConfig: () => Config, getConfigPath: () => string, getFinder?: () => QaInstructionsFinder, getEvidence?: () => EvidenceLocation): Command;
