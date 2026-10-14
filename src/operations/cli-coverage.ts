import type { Command } from "commander";
import { z } from "zod";
import { CliRouteSchema, OperationIdSchema, type CliRoute } from "./operation.schema.js";
import type { OperationCatalog } from "./operation-registry.js";

const RouteDispositionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("supported"),
    route: CliRouteSchema,
    operationId: OperationIdSchema,
  }),
  z.object({
    status: z.literal("pending-migration"),
    route: CliRouteSchema,
    operationId: OperationIdSchema,
  }),
  z.object({ status: z.literal("excluded"), route: CliRouteSchema, reason: z.string().min(1) }),
]);
const CliRouteCoveragePropsSchema = z.object({ entries: z.array(RouteDispositionSchema) });

export type RouteDisposition = z.infer<typeof RouteDispositionSchema>;

export interface CliRouteCoverage {
  check(program: Command, catalog: OperationCatalog): CliRoute[];
  assertComplete(program: Command, catalog: OperationCatalog): void;
  list(): RouteDisposition[];
}

export class CliRouteCoverageError extends Error {
  override name = "CliRouteCoverageError";
}

/** Explicitly records how each executable CLI route is served by the shared core. */
export class ManifestCliRouteCoverage implements CliRouteCoverage {
  private readonly entries: RouteDisposition[];

  constructor(props: z.input<typeof CliRouteCoveragePropsSchema>) {
    this.entries = CliRouteCoveragePropsSchema.parse(props).entries;
  }

  check(program: Command, catalog: OperationCatalog): CliRoute[] {
    const discovered = ManifestCliRouteCoverage.discover(program);
    const byPath = new Map<string, RouteDisposition>();
    for (const entry of this.entries) {
      const key = ManifestCliRouteCoverage.routeKey(entry.route.path);
      if (byPath.has(key)) throw new CliRouteCoverageError(`Duplicate route disposition: ${key}`);
      byPath.set(key, entry);
    }

    const discoveredKeys = discovered.map((route) => ManifestCliRouteCoverage.routeKey(route.path));
    const actual = new Set(discoveredKeys);
    if (actual.size !== discoveredKeys.length) {
      const duplicate = discoveredKeys.find((key, index) => discoveredKeys.indexOf(key) !== index);
      throw new CliRouteCoverageError(`Duplicate actionable CLI route: ${duplicate ?? "unknown"}`);
    }

    const missing = discovered
      .filter((route) => !byPath.has(ManifestCliRouteCoverage.routeKey(route.path)))
      .map((route) => ManifestCliRouteCoverage.routeKey(route.path));
    const stale = this.entries
      .filter((entry) => !actual.has(ManifestCliRouteCoverage.routeKey(entry.route.path)))
      .map((entry) => ManifestCliRouteCoverage.routeKey(entry.route.path));
    if (missing.length > 0 || stale.length > 0) {
      throw new CliRouteCoverageError(
        `CLI route coverage drift; missing: ${missing.join(", ") || "none"}; unknown: ${stale.join(", ") || "none"}`,
      );
    }

    for (const route of discovered) {
      const entry = byPath.get(ManifestCliRouteCoverage.routeKey(route.path));
      if (entry === undefined)
        throw new CliRouteCoverageError(
          `Missing disposition: ${ManifestCliRouteCoverage.routeKey(route.path)}`,
        );
      if (!ManifestCliRouteCoverage.sameAliases(route.aliases, entry.route.aliases)) {
        throw new CliRouteCoverageError(
          `Alias coverage drift: ${ManifestCliRouteCoverage.routeKey(route.path)}`,
        );
      }
    }

    this.checkCatalog(catalog.list(), byPath);
    return discovered;
  }

  assertComplete(program: Command, catalog: OperationCatalog): void {
    this.check(program, catalog);
    const pending = this.entries
      .filter((entry) => entry.status === "pending-migration")
      .map((entry) => ManifestCliRouteCoverage.routeKey(entry.route.path));
    if (pending.length > 0)
      throw new CliRouteCoverageError(
        `Core operations remain pending migration: ${pending.join(", ")}`,
      );
  }

  list(): RouteDisposition[] {
    return this.entries.map((entry) => structuredClone(entry));
  }

  private checkCatalog(
    operations: ReturnType<OperationCatalog["list"]>,
    dispositions: Map<string, RouteDisposition>,
  ): void {
    const operationIds = new Set<string>();
    const operationRoutes = new Set<string>();

    for (const operation of operations) {
      if (operationIds.has(operation.id))
        throw new CliRouteCoverageError(`Duplicate executable operation id: ${operation.id}`);
      operationIds.add(operation.id);

      const key = ManifestCliRouteCoverage.routeKey(operation.cli.path);
      if (operationRoutes.has(key))
        throw new CliRouteCoverageError(`Duplicate executable operation route: ${key}`);
      operationRoutes.add(key);

      const disposition = dispositions.get(key);
      if (disposition?.status !== "supported") {
        throw new CliRouteCoverageError(
          `Executable operation ${operation.id} has no supported CLI route: ${key}`,
        );
      }
      if (
        disposition.operationId !== operation.id ||
        !ManifestCliRouteCoverage.sameAliases(operation.cli.aliases, disposition.route.aliases)
      ) {
        throw new CliRouteCoverageError(`Executable operation mapping mismatch: ${key}`);
      }
    }

    for (const disposition of dispositions.values()) {
      if (disposition.status !== "supported") continue;

      const matchingOperations = operations.filter(
        (operation) => operation.id === disposition.operationId,
      );
      if (matchingOperations.length !== 1) {
        throw new CliRouteCoverageError(
          `Supported CLI route ${ManifestCliRouteCoverage.routeKey(disposition.route.path)} must map to exactly one executable operation`,
        );
      }
      const operation = matchingOperations[0];
      if (
        operation === undefined ||
        ManifestCliRouteCoverage.routeKey(operation.cli.path) !==
          ManifestCliRouteCoverage.routeKey(disposition.route.path)
      ) {
        throw new CliRouteCoverageError(
          `Supported CLI route mapping mismatch: ${ManifestCliRouteCoverage.routeKey(disposition.route.path)}`,
        );
      }
    }
  }

  static routeKey(path: string[]): string {
    return path.join(" ");
  }

  static sameAliases(left: string[], right: string[]): boolean {
    return left.slice().sort().join("\0") === right.slice().sort().join("\0");
  }

  static discover(program: Command): CliRoute[] {
    const routes: CliRoute[] = [];
    const visit = (command: Command, parentPath: string[]): void => {
      const currentPath =
        command.name() === program.name() && parentPath.length === 0
          ? parentPath
          : [...parentPath, command.name()];
      const actionHandler = Object.getOwnPropertyDescriptor(command, "_actionHandler")?.value;
      if (typeof actionHandler === "function") {
        const aliases = typeof command.aliases === "function" ? command.aliases() : [];
        routes.push({ path: currentPath, aliases: [...aliases] });
      }
      for (const child of command.commands) visit(child, currentPath);
    };

    visit(program, []);
    return routes;
  }
}

const pendingRoutes = [
  "pr create",
  "pr comment",
  "pr list",
  "pr request-review",
  "board post heartbeat",
  "board post item",
  "board post activity",
  "board items",
  "packet create",
  "packet new-id",
  "packet update",
  "packet get",
  "packet reviewers",
];

const excludedRoutes = [
  {
    path: ["mcp"],
    aliases: [],
    reason:
      "Starts a local stdio transport whose operations are registered from the shared catalog.",
  },
  {
    path: ["hook", "pre-bash"],
    aliases: ["guard-commit"],
    reason: "Consumes Claude hook payloads and governs host shell commands.",
  },
  {
    path: ["hook", "board-heartbeat"],
    aliases: [],
    reason: "Consumes Claude PostToolUse payloads and runs as a host hook.",
  },
  {
    path: ["hook", "agent-dispatch"],
    aliases: [],
    reason: "Consumes Claude PreToolUse agent payloads for local session tracking.",
  },
  {
    path: ["hook", "agent-stop"],
    aliases: [],
    reason: "Consumes Claude SubagentStop payloads and reports host lifecycle events.",
  },
  {
    path: ["agents", "status"],
    aliases: [],
    reason: "Inspects native Codex registration files on the local host.",
  },
  {
    path: ["agents", "install"],
    aliases: [],
    reason: "Installs native Codex agent registrations into host-owned directories.",
  },
  {
    path: ["board", "login"],
    aliases: [],
    reason: "Provisions a machine-local Ariadne credential from interactive input.",
  },
  { path: ["board", "logout"], aliases: [], reason: "Removes a machine-local Ariadne credential." },
];

/** Records domain migration states and the local MCP transport launcher. */
export const cliRouteCoverage: CliRouteCoverage = new ManifestCliRouteCoverage({
  entries: [
    { status: "supported", route: { path: ["doc"], aliases: [] }, operationId: "doc" },
    ...[
      ["tdd create", "tdd-create"],
      ["epic create", "epic-create"],
      ["epic edit", "epic-edit"],
      ["epic link-initiative", "epic-link-initiative"],
      ["initiative create", "initiative-create"],
      ["initiative edit", "initiative-edit"],
      ["ticket create", "ticket-create"],
      ["ticket edit", "ticket-edit"],
      ["ticket get", "ticket-get"],
      ["ticket transitions", "ticket-transitions"],
      ["ticket block", "ticket-block"],
      ["ticket unblock", "ticket-unblock"],
      ["ticket status", "ticket-status"],
      ["ticket comment", "ticket-comment"],
      ["ticket label", "ticket-label"],
      ["users get", "users-get"],
      ["tdd get", "tdd-get"],
      ["epic get", "epic-get"],
      ["epic plan", "epic-plan"],
      ["epic review-plan", "epic-review-plan"],
      ["initiative get", "initiative-get"],
      ["initiative plan", "initiative-plan"],
      ["initiative review-plan", "initiative-review-plan"],
      ["charter", "charter"],
      ["competencies", "competencies"],
      ["rfc dir", "rfc-dir"],
      ["rfc next-id", "rfc-next-id"],
      ["qa instructions", "qa-instructions"],
      ["qa evidence-dir", "qa-evidence-dir"],
      ["qa recipe", "qa-recipe"],
      ["config path", "config-path"],
      ["config show", "config-show"],
      ["config set", "config-set"],
      ["config unset", "config-unset"],
      ["git commit", "git-commit"],
      ["git checkout", "git-checkout"],
      ["git push", "git-push"],
      ["commit-message", "commit-message"],
      ["branch-name", "branch-name"],
      ["check", "check"],
      ["review schema", "review-schema"],
      ["review validate", "review-validate"],
      ["review render", "review-render"],
      ["review state", "review-state"],
      ["review context", "review-context"],
      ["review plan", "review-plan"],
    ].map(([path, operationId]) => ({
      status: "supported" as const,
      route: { path: (path ?? "").split(" "), aliases: [] },
      operationId: operationId ?? "",
    })),
    ...pendingRoutes.map((path) => ({
      status: "pending-migration" as const,
      route: { path: path.split(" "), aliases: [] },
      operationId: `cli-${path.replaceAll(" ", "-")}`,
    })),
    ...excludedRoutes.map((route) => ({
      status: "excluded" as const,
      route,
      reason: route.reason,
    })),
  ],
});
