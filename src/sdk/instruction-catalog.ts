import { FileInstructionCatalog, type InstructionCatalog } from "./instruction-catalog-core.js";

export {
  FileInstructionCatalog,
  UnknownInstructionError,
  InstructionsUnavailableError,
  UnsafeInstructionPathError,
} from "./instruction-catalog-core.js";
export type { InstructionCatalog, CanonicalInstruction } from "./instruction-catalog-core.js";

export const instructionCatalog: InstructionCatalog = new FileInstructionCatalog({
  moduleUrl: import.meta.url,
  env: process.env,
});
