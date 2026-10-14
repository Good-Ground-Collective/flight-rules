import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  FlightRulesMcpServer,
  McpLaunchPropsSchema,
  type McpProtocolServerFactory,
} from "./mcp-server.js";

const StdioLaunchPropsSchema = McpLaunchPropsSchema.extend({
  cwd: z.string().min(1).default(process.cwd()),
  env: z.record(z.string(), z.string().optional()).default(() => ({ ...process.env })),
});

export type StdioLaunchProps = z.input<typeof StdioLaunchPropsSchema>;

export interface FlightRulesMcpTransport {
  serve(): Promise<void>;
}

/** Owns one launch-bound server across modern and legacy stdio connections. */
export class StdioFlightRulesMcpTransport implements FlightRulesMcpTransport {
  private readonly launch: z.infer<typeof StdioLaunchPropsSchema>;

  constructor(props: StdioLaunchProps = {}) {
    this.launch = StdioLaunchPropsSchema.parse(props);
  }

  async serve(): Promise<void> {
    const service: McpProtocolServerFactory = new FlightRulesMcpServer(this.launch);
    process.stderr.write(
      "flight-rules MCP: cancellation prevents a late reply, but running work may finish and completed operations cannot be rolled back.\n",
    );
    await serveStdio(() => service.createProtocolServer(), { legacy: "serve" });
  }
}

export { StdioLaunchPropsSchema };
