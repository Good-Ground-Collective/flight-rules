# Native plugin packages

`NativePluginCompiler` assembles a self-contained Claude package under `dist/claude`. The package contains generated native agent registrations, canonical skills and resources, docs, the bundled CLI and its executable shim, existing Claude hooks, model bindings and a native manifest.

Canonical identity lives in `adapters/plugin.json`; version comes from the root package. Skill and document bytes are copied unchanged. Agent metadata is emitted from the neutral registry, with the canonical prompt body preserved. A fresh assembly replaces the owned target tree so removed resources do not survive an earlier build. Source symlinks and a symlinked output parent fail validation before replacement.

```typescript
import { NativePluginCompiler } from '@good-ground-collective/flight-rules';

const plugin = new NativePluginCompiler({ sourceDir: '/path/to/flight-rules' }).compile();
console.log(plugin.directory, plugin.agents);
```

Build the CLI before assembly. The normal `npm run build` does both. The native CLI resolves docs inside its own package after relocation; hook commands use that package's bin directory. Native validation and a live fixture can be run with:

```bash
claude plugin validate dist/claude/.claude-plugin/plugin.json
node scripts/test-agents-live.mjs dist/claude
```

The live command uses three Claude sessions capped at $1 each. The complete tree passed validation and the three-role failing-to-passing fixture on Claude Code 2.1.296. In-process tests also check every canonical resource byte, decoded prompts, relocation, executable permissions, stale-file removal and source/output symlink rejection.

The existing marketplace still loads the repository root. Its agent bridge points at the same generated registrations, so this assembly slice preserves that install path. The later release-ownership change will commit the complete native tree and move the marketplace source to it. Codex assembly and native installation/setup remain separate slices.
