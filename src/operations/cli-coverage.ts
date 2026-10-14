import type { Command } from "commander";
import { z } from "zod";
import { CliRouteSchema, OperationIdSchema, type CliRoute } from "./operation.schema.js";

const RouteDispositionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("supported"), route: CliRouteSchema, operationId: OperationIdSchema }),
  z.object({ status: z.literal("pending-migration"), route: CliRouteSchema, operationId: OperationIdSchema }),
  z.object({ status: z.literal("excluded"), route: CliRouteSchema, reason: z.string().min(1) }),
]);
const CliRouteCoveragePropsSchema = z.object({ entries: z.array(RouteDispositionSchema) });

export type RouteDisposition = z.infer<typeof RouteDispositionSchema>;

export class CliRouteCoverageError extends Error {
  override name = "CliRouteCoverageError";
}

/** Explicitly records how each executable CLI route is served by the shared core. */
export class CliRouteCoverage {
  private readonly entries: RouteDisposition[];

  constructor(props: z.input<typeof CliRouteCoveragePropsSchema>) {
    this.entries = CliRouteCoveragePropsSchema.parse(props).entries;
  }

  check(program: Command): CliRoute[] {
    const discovered = CliRouteCoverage.discover(program);
    const byPath = new Map<string, RouteDisposition>();
    for (const entry of this.entries) {
      const key = CliRouteCoverage.routeKey(entry.route.path);
      if (byPath.has(key)) throw new CliRouteCoverageError(`Duplicate route disposition: ${key}`);
      byPath.set(key, entry);
    }

    const actual = new Set(discovered.map(route => CliRouteCoverage.routeKey(route.path)));
    const missing = discovered.filter(route => !byPath.has(CliRouteCoverage.routeKey(route.path))).map(route => CliRouteCoverage.routeKey(route.path));
    const stale = this.entries.filter(entry => !actual.has(CliRouteCoverage.routeKey(entry.route.path))).map(entry => CliRouteCoverage.routeKey(entry.route.path));
    if (missing.length > 0 || stale.length > 0) {
      throw new CliRouteCoverageError(`CLI route coverage drift; missing: ${missing.join(", ") || "none"}; unknown: ${stale.join(", ") || "none"}`);
    }

    for (const route of discovered) {
      const entry = byPath.get(CliRouteCoverage.routeKey(route.path));
      if (entry === undefined) throw new CliRouteCoverageError(`Missing disposition: ${CliRouteCoverage.routeKey(route.path)}`);
      if (!CliRouteCoverage.sameAliases(route.aliases, entry.route.aliases)) {
        throw new CliRouteCoverageError(`Alias coverage drift: ${CliRouteCoverage.routeKey(route.path)}`);
      }
    }
    return discovered;
  }

  assertComplete(program: Command): void {
    this.check(program);
    const pending = this.entries.filter(entry => entry.status === "pending-migration").map(entry => CliRouteCoverage.routeKey(entry.route.path));
    if (pending.length > 0) throw new CliRouteCoverageError(`Core operations remain pending migration: ${pending.join(", ")}`);
  }

  list(): RouteDisposition[] {
    return this.entries.map(entry => structuredClone(entry));
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
      const currentPath = command.name() === program.name() && parentPath.length === 0
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
  "charter", "competencies", "rfc dir", "rfc next-id", "qa instructions", "qa evidence-dir", "qa recipe",
  "config path", "config show", "config set", "config unset", "check", "ticket get", "ticket transitions",
  "users get", "tdd get", "tdd create", "epic get", "epic create", "epic edit", "epic plan", "epic review-plan",
  "epic link-initiative", "initiative get", "initiative create", "initiative edit", "initiative plan", "initiative review-plan",
  "ticket create", "ticket edit", "ticket block", "ticket unblock", "ticket status", "ticket comment", "ticket label",
  "git commit", "git checkout", "git push", "commit-message", "branch-name", "pr create", "pr comment", "pr list",
  "pr request-review", "review schema", "review validate", "review render", "review state", "review context", "review plan",
  "board post heartbeat", "board post item", "board post activity", "board items", "packet create", "packet new-id",
  "packet update", "packet get", "packet reviewers",
];

const excludedRoutes = [
  { path: ["hook", "pre-bash"], aliases: ["guard-commit"], reason: "Consumes Claude hook payloads and governs host shell commands." },
  { path: ["hook", "board-heartbeat"], aliases: [], reason: "Consumes Claude PostToolUse payloads and runs as a host hook." },
  { path: ["hook", "agent-dispatch"], aliases: [], reason: "Consumes Claude PreToolUse agent payloads for local session tracking." },
  { path: ["hook", "agent-stop"], aliases: [], reason: "Consumes Claude SubagentStop payloads and reports host lifecycle events." },
  { path: ["agents", "status"], aliases: [], reason: "Inspects native Codex registration files on the local host." },
  { path: ["agents", "install"], aliases: [], reason: "Installs native Codex agent registrations into host-owned directories." },
  { path: ["board", "login"], aliases: [], reason: "Provisions a machine-local Ariadne credential from interactive input." },
  { path: ["board", "logout"], aliases: [], reason: "Removes a machine-local Ariadne credential." },
];

/** Inventory of the existing 68 CLI routes; pending entries stay unavailable to operation consumers. */
export const cliRouteCoverage = new CliRouteCoverage({
  entries: [
    { status: "supported", route: { path: ["doc"], aliases: [] }, operationId: "doc" },
    ...pendingRoutes.map(path => ({
      status: "pending-migration" as const,
      route: { path: path.split(" "), aliases: [] },
      operationId: `cli-${path.replaceAll(" ", "-")}`,
    })),
    ...excludedRoutes.map(route => ({ status: "excluded" as const, route, reason: route.reason })),
  ],
});
