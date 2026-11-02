import type { WorkerCapability } from './worker-runtime-core.js'

export interface ClaudeBuiltInToolCatalog {
	toolsFor(capability: WorkerCapability): string[]
}

/** Names the Claude built-in tools that enforce a worker capability; spawn and ask have none and need an orchestration adapter. */
export class StandardClaudeBuiltInToolCatalog implements ClaudeBuiltInToolCatalog {
	toolsFor(capability: WorkerCapability): string[] {
		if (capability === 'read') return ['Glob', 'Grep', 'Read']
		if (capability === 'edit') return ['Write', 'Edit']
		if (capability === 'shell') return ['Bash']
		if (capability === 'web') return ['WebSearch', 'WebFetch']
		return []
	}
}

export const claudeBuiltInTools: ClaudeBuiltInToolCatalog =
	new StandardClaudeBuiltInToolCatalog()
