---
name: full-agent
description: Implements and verifies work.
capabilities: [read, edit, shell, web, spawn, ask]
model: escalated
reasoning: high
sandbox:
  fs: workspace-write
  network: enabled
dispatch:
  maxConcurrent: 8
  maxDepth: 1
x-claude:
  color: cyan
---

Agent instructions.
