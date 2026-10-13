# Native plugin packages

`NativePluginCompiler` assembles native packages under `dist/claude` and `dist/codex`. Both contain canonical skills and resources, docs, the bundled CLI and executable shim, model bindings and native manifests. Claude also contains native Markdown agent registrations and existing Claude hooks. Codex contains standalone TOML agent registrations under `.codex/agents` and the reasoning profile.

Canonical identity lives in `adapters/plugin.json`; version comes from the root package. Skill and document bytes are copied unchanged. Agent metadata is emitted from the neutral registry, with the canonical prompt body preserved. A fresh assembly replaces the owned target tree so removed resources do not survive an earlier build. Source symlinks and a symlinked output parent fail validation before replacement.

```typescript
import { NativePluginCompiler } from '@good-ground-collective/flight-rules';

const plugin = new NativePluginCompiler({ sourceDir: '/path/to/flight-rules' }).compile();
const codex = new NativePluginCompiler({ sourceDir: '/path/to/flight-rules' }).compile('codex');
console.log(plugin.directory, plugin.agents);
```

Build the CLI before assembly. The normal `npm run build` does both. The native CLI resolves docs inside its own package after relocation; hook commands use that package's bin directory. Native validation and a live fixture can be run with:

```bash
claude plugin validate dist/claude/.claude-plugin/plugin.json
node scripts/test-agents-live.mjs dist/claude
```

The live command uses three Claude sessions capped at $1 each. The complete tree passed validation and the three-role failing-to-passing fixture on Claude Code 2.1.296. In-process tests also check every canonical resource byte, decoded prompts, relocation, executable permissions, stale-file removal and source/output symlink rejection.

The Codex tree includes a portable root `plugin.json` and a `.codex-plugin/plugin.json` compatibility manifest. Codex discovers skills from the plugin, but its plugin manifest has no agent component. Installing the plugin therefore does not register `.codex/agents` in a consuming project. E5 will handle project registration and CLI placement; this package supplies their native source files. The Codex tree emits no Claude hooks. `diagnostics.json` records that omission, absent per-agent tool allowlists, parent sandbox overrides and ignored Claude color metadata.

The repository catalog at `.agents/plugins/marketplace.json` points to `./dist/codex`, relative to the repository root. Run the installed client's parser and read-only marketplace APIs against a relocated fixture with:

```bash
node scripts/test-codex-agent-config.mjs dist/codex
```

The check copies the package's actual `.codex` files into a trusted temporary project, requires an intentionally malformed role to generate a parser warning, then requires all seven generated roles to load without warnings. It also discovers the native catalog, reads the plugin and checks every canonical skill name and version. It makes no model turns or installation changes. Codex 0.162.1 passed these checks. This proves native parsing and discovery; actual Codex execution, model access and orchestrated permissions remain later work. The packaged CLI resolves docs after relocation, but consumers still need to expose it on PATH.

The existing Claude marketplace still loads the repository root. Its agent bridge points at the same generated registrations. The release-ownership slice will commit both complete native trees and move the Claude marketplace source to `dist/claude`; publishing complete catalog targets is part of that slice.
