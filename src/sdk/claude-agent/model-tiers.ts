import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ModelBindingsSchema } from "../../agents/agent-emitter/agent-emitter.schema.js";
import { packageHomeLocator } from "../instruction-catalog-core.js";

export type ClaudeModelBindings = z.output<typeof ModelBindingsSchema>;

const ModelTiersFileSchema = z
  .string()
  .transform((text) => JSON.parse(text))
  .pipe(ModelBindingsSchema);
const FileModelTierCatalogPropsSchema = z.strictObject({
  moduleUrl: z.string().min(1),
  env: z.record(z.string(), z.string().optional()),
});

export class ModelTiersUnavailableError extends Error {
  override name = "ModelTiersUnavailableError";
}

export interface ModelTierCatalog {
  load(): ClaudeModelBindings;
}

/** Reads the reviewed Claude tier table shipped with the installed package, independent of cwd. */
export class FileModelTierCatalog implements ModelTierCatalog {
  private readonly path: string;

  constructor(props: z.input<typeof FileModelTierCatalogPropsSchema>) {
    const parsed = FileModelTierCatalogPropsSchema.parse({ ...props, env: { ...props.env } });
    this.path = join(packageHomeLocator.locate(parsed), "adapters", "claude", "model-tiers.json");
  }

  load(): ClaudeModelBindings {
    try {
      return ModelTiersFileSchema.parse(readFileSync(this.path, "utf8"));
    } catch (cause) {
      throw new ModelTiersUnavailableError(
        `The Claude model tier table at ${this.path} could not be loaded.`,
        { cause },
      );
    }
  }
}

export const claudeModelTiers: ModelTierCatalog = new FileModelTierCatalog({
  moduleUrl: import.meta.url,
  env: process.env,
});
