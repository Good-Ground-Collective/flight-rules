# MCP server

`flight-rules mcp` serves completed flight-rules operations and canonical instructions over the official TypeScript MCP server. The stdio transport keeps standard output for protocol messages and writes launch diagnostics to standard error.

The default launch grants allow operations composed only of `read`, `process`, and `network` effects. Operations with a `write` effect are denied unless the launch grants `write` or names that operation with `--allow-operation`. Config writes also require a matching `--allow-config-scope` value. Config writes are confined to the launch checkout. A request cannot add grants or select a different checkout. The server captures the checkout's directory identity at launch and rejects tool calls while that path is moved or replaced, including replacement by a symlink.

For example, allow a local configuration edit in the checkout's project scope:

```sh
flight-rules mcp --allow-operation config-set --allow-config-scope project
```

The server publishes one MCP tool per completed operation descriptor. Each call goes through the shared input and output schemas and returns structured data with a text representation. An operation failure returns its domain error name and message without terminating the server. Pending CLI routes remain unavailable until their shared operation handlers are complete.

The `flight-rules://skills/<name>` resources return the canonical skill Markdown. The `flight-rules://agents/<name>` resources return each named registration's canonical prompt body; role metadata and variant settings remain separate. Reading an instruction resource supplies context only; it does not invoke a skill or dispatch an agent.

The MCP SDK supports modern protocol discovery and the legacy initialize exchange. Cancellation prevents a late protocol reply, but an operation already in progress may finish because shared domain services do not accept abort signals. Cancellation cannot undo a completed file, Git, or remote mutation. Closing standard input requests graceful shutdown.
