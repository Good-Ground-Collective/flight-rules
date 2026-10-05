import { Command, Option } from "commander";
import { configScopes } from "../../config-store.js";
import type { ConfigScope, ConfigStore } from "../../config-store.js";

const scopeHelp =
  "where to write: user (~/.claude/settings.json), project (.claude/settings.json), local (.claude/settings.local.json), or file (the flight-rules config file)";

export function createConfigCommand(getStore: () => ConfigStore): Command {
  const config = new Command("config");
  config.exitOverride();

  config
    .command("path")
    .description("print the resolved config file path, whether or not it exists")
    .exitOverride()
    .action(() => {
      process.stdout.write(`${getStore().filePath()}\n`);
    });

  config
    .command("show")
    .description("print the merged config, which file each value came from, and whether it is valid")
    .exitOverride()
    .action(() => {
      process.stdout.write(JSON.stringify(getStore().inspect()) + "\n");
    });

  config
    .command("set")
    .description("write one config value; array keys take several values")
    .argument("<key>")
    .argument("<values...>")
    .addOption(new Option("--scope <scope>", scopeHelp).choices(configScopes))
    .exitOverride()
    .action((key: string, values: string[], opts: { scope?: ConfigScope }) => {
      const store = getStore();
      const scope = opts.scope ?? store.defaultScopeFor(key);
      store.set(key, values, scope);
      const shadowedBy = store.shadowingScope(key, scope);
      process.stdout.write(
        JSON.stringify({
          key,
          scope,
          path: store.pathFor(scope),
          ...(shadowedBy !== undefined
            ? {
                warning: `${key} is also set in ${shadowedBy} scope (${store.pathFor(shadowedBy)}), which takes precedence`,
              }
            : {}),
        }) + "\n",
      );
    });

  config
    .command("unset")
    .description("remove one config value from a scope")
    .argument("<key>")
    .addOption(new Option("--scope <scope>", scopeHelp).choices(configScopes))
    .exitOverride()
    .action((key: string, opts: { scope?: ConfigScope }) => {
      const store = getStore();
      const scope = opts.scope ?? store.defaultScopeFor(key);
      store.unset(key, scope);
      process.stdout.write(
        JSON.stringify({ key, scope, path: store.pathFor(scope) }) + "\n",
      );
    });

  return config;
}
