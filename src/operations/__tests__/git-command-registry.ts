import { NodeGitExecutor, type GitExecutor } from "../../git/git-executor/git-executor.js";
import { ConfigStore, configScopes } from "../../shared/config-store.js";
import { DefaultGitConfigOperations } from "../git-config-operations.js";
import { LaunchOperationAccessPolicy, MapOperationRegistry } from "../operation-registry.js";

export const createGitCommandRegistry = (
  git: GitExecutor = new NodeGitExecutor(),
): MapOperationRegistry => {
  const cwd = process.cwd();
  const configStore = new ConfigStore({ cwd, home: cwd, env: { FLIGHT_RULES_HOST: "codex" } });
  return new MapOperationRegistry({
    operations: new DefaultGitConfigOperations({
      cwd,
      configStore,
      git,
      configPolicy: { scopes: [...configScopes], roots: [cwd] },
    }).operations(),
    policy: new LaunchOperationAccessPolicy({
      allowedEffects: ["read", "write", "network", "process"],
    }),
  });
};
