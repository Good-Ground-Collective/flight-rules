import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { FileAgentRegistry } from '../../../agents/agent-registry/agent-registry.js'
import type { OperationEffect } from '../../../operations/operation.schema.js'
import {
	LaunchOperationAccessPolicy,
	MapOperationRegistry,
} from '../../../operations/operation-registry.js'
import type {
	CallerContext,
	RuntimeSnapshot,
} from '../../../orchestration/orchestration.schema.js'
import { instructionCatalog } from '../../instruction-catalog.js'
import { SkillOperationRoutes } from '../../skill-runtime-core.js'
import type { WorkerRuntimeContract } from '../../worker-runtime-core.js'
import { ClaudeAgentSkillRuntime } from '../skill-runtime.js'
import {
	ScriptedClaudeQuery,
	type QueryScript,
} from './scripted-claude-query.js'

const context: CallerContext = {
	runId: 'routes',
	taskId: 'remediate',
	cwd: '/repo',
	repositoryRoot: '/repo',
	baseRef: 'main',
	skill: 'remediate-review',
	attempt: 1,
}
const allowed = {
	state: 'available',
	evidence: 'Host observed access.',
} as const
const agents = new FileAgentRegistry().load(
	fileURLToPath(new URL('../../../../agents', import.meta.url)),
)
const operationTool = 'mcp__flight-rules__flight_rules_operation'
const workers: WorkerRuntimeContract = {
	dispatch: async () => {
		throw new Error('No dispatch expected.')
	},
	dispatchMany: async () => [],
}

const snapshot = (): RuntimeSnapshot => ({
	context,
	host: { name: 'test-host', version: '1' },
	observedAt: new Date().toISOString(),
	agent: null,
	spawn: allowed,
	ask: allowed,
	permissions: {
		read: allowed,
		edit: allowed,
		shell: allowed,
		web: allowed,
		spawn: allowed,
		ask: allowed,
	},
	limits: {
		maxConcurrent: 3,
		activeWorkers: 0,
		currentDepth: 0,
		maxDepth: 1,
		source: 'test',
	},
})

const descriptors = [
	['check', ['check'], ['read']],
	['pr-threads', ['pr', 'threads'], ['read']],
	['pr-thread-reply', ['pr', 'thread-reply'], ['write']],
	['pr-comment', ['pr', 'comment'], ['write']],
] as const

function runtimeFor(
	script: QueryScript,
	admittedIds: string[],
	calls = vi.fn(),
) {
	const scripted = new ScriptedClaudeQuery({ response: 'done', ...script })
	const operations = new MapOperationRegistry({
		operations: descriptors.map(([id, path, effects]) => ({
			id,
			description: id,
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}).passthrough(),
			effects: [...effects] as OperationEffect[],
			cli: { path: [...path], aliases: [] },
			handler: async (input: object) => {
				calls(id)
				return input
			},
		})),
		policy: new LaunchOperationAccessPolicy({
			allowedOperationIds: admittedIds,
		}),
	})
	const skills = new ClaudeAgentSkillRuntime({
		instructions: instructionCatalog,
		agents,
		models: {
			standard: 'standard-model',
			escalated: 'escalated-model',
			expert: 'expert-model',
		},
		operations,
		workers,
		observe: async () => snapshot(),
		toolGrants: () => ({}),
		query: scripted.query as never,
	})
	return { skills, scripted, calls }
}

const bash = (command: string) => ({ name: 'Bash', input: { command } })
const operation = (operationId: string) => ({
	name: operationTool,
	input: { operationId, input: {} },
})

describe('skill operation routes', () => {
	it('lists admitted routes in the prompt between the instructions and the invocation context', async () => {
		const { skills, scripted } = runtimeFor({}, ['check', 'pr-threads'])

		await skills.invoke('remediate-review', context, {})

		const prompt = scripted.invocations[0]?.prompt ?? ''
		const canonical =
			instructionCatalog.loadSkill('remediate-review').contents
		expect(prompt).toContain('`flight-rules pr threads` -> `pr-threads`')
		expect(prompt).toContain('`flight-rules check` -> `check`')
		expect(prompt).toContain('flight_rules_operation')
		expect(prompt).toContain(
			'an input object holding the fields that operation expects',
		)
		expect(prompt).not.toContain("the command's arguments")
		expect(prompt).not.toContain('pr-thread-reply')
		expect(prompt).not.toContain('pr-comment')
		const section = prompt.indexOf('## Operations instead of the shell')
		expect(prompt.indexOf(canonical)).toBe(0)
		expect(section).toBeGreaterThanOrEqual(canonical.length)
		expect(section).toBeLessThan(prompt.indexOf('## Invocation context'))
	})

	it('treats substitutions, backticks and subshells as segment boundaries', () => {
		const routes = new SkillOperationRoutes({
			operations: [
				{
					id: 'pr-threads',
					description: '',
					effects: ['read'],
					cli: { path: ['pr', 'threads'], aliases: [] },
				},
			],
		})
		for (const command of [
			'THREADS=$(flight-rules pr threads 21)',
			'echo `flight-rules pr threads 21`',
			'(flight-rules pr threads 21)',
		])
			expect(routes.redirectFor(command)).toEqual({
				route: 'pr threads',
				operationId: 'pr-threads',
			})
	})

	it('builds alias routes from the parent path and the alias leaf', () => {
		const routes = new SkillOperationRoutes({
			operations: [
				{
					id: 'hook-pre-bash',
					description: '',
					effects: ['read'],
					cli: {
						path: ['hook', 'pre-bash'],
						aliases: ['guard-commit'],
					},
				},
			],
		})
		expect(
			routes.redirectFor('flight-rules hook guard-commit')?.operationId,
		).toBe('hook-pre-bash')
		expect(routes.redirectFor('flight-rules guard-commit')).toBeUndefined()
		expect(routes.promptSection()).toContain(
			'`flight-rules hook guard-commit`',
		)
	})

	it('runs without a prompt section or redirects when the registry has no admitted()', async () => {
		const scripted = new ScriptedClaudeQuery({
			response: 'done',
			turns: [[bash('flight-rules pr threads 21')]],
		})
		const skills = new ClaudeAgentSkillRuntime({
			instructions: instructionCatalog,
			agents,
			models: { standard: 's', escalated: 'e', expert: 'x' },
			operations: {
				list: () => [],
				invoke: async () => {
					throw new Error('No invoke expected.')
				},
			},
			workers,
			observe: async () => snapshot(),
			toolGrants: () => ({}),
			query: scripted.query as never,
		})

		const result = await skills.invoke('remediate-review', context, {})

		expect(result.status).toBe('completed')
		expect(scripted.invocations[0]?.prompt).not.toContain(
			'## Operations instead of the shell',
		)
		expect(scripted.denials).toEqual([])
	})

	it('omits the section when no operation is admitted', () => {
		expect(
			new SkillOperationRoutes({ operations: [] }).promptSection(),
		).toBe('')
	})

	it('denies shell forms of a backed route without ending the run', async () => {
		const commands = [
			'flight-rules pr threads 21 --trusted-author x',
			'npx flight-rules pr threads 21 --trusted-author x',
			'npx -y flight-rules pr threads 21',
			'/opt/pkg/bin/flight-rules.mjs pr threads 21',
			'node /opt/pkg/bin/flight-rules.mjs pr threads 21',
			'FOO=1 flight-rules pr threads 21',
			'git status && flight-rules pr threads 21',
			'echo hi; flight-rules pr threads 21 | jq .',
		]
		const { skills, scripted } = runtimeFor(
			{ turns: [commands.map(bash)] },
			['check', 'pr-threads'],
		)

		const result = await skills.invoke('remediate-review', context, {})

		expect(result.status).toBe('completed')
		expect(scripted.denials).toHaveLength(commands.length)
		for (const denial of scripted.denials) {
			expect(denial.reason).toContain('operationId "pr-threads"')
			expect(denial.reason).toContain('flight_rules_operation')
		}
		expect(scripted.executedBuiltIns).toEqual([])
	})

	it('lets unbacked routes and other commands through', async () => {
		const commands = [
			'flight-rules git commit -m x',
			'flight-rules pr thread-reply 1',
			'git status',
			'echo flight-rules pr threads',
		]
		const { skills, scripted } = runtimeFor(
			{ turns: [commands.map(bash)] },
			['check', 'pr-threads'],
		)

		const result = await skills.invoke('remediate-review', context, {})

		expect(result.status).toBe('completed')
		expect(scripted.denials).toEqual([])
		expect(scripted.executedBuiltIns).toEqual(
			Array(commands.length).fill('Bash'),
		)
	})

	it('picks the longest matching route', () => {
		const routes = new SkillOperationRoutes({
			operations: [
				{
					id: 'pr',
					description: '',
					effects: ['read'],
					cli: { path: ['pr'], aliases: [] },
				},
				{
					id: 'pr-thread-reply',
					description: '',
					effects: ['write'],
					cli: { path: ['pr', 'thread-reply'], aliases: [] },
				},
				{
					id: 'pr-threads',
					description: '',
					effects: ['read'],
					cli: { path: ['pr', 'threads'], aliases: [] },
				},
			],
		})

		expect(
			routes.redirectFor('flight-rules pr thread-reply 3')?.operationId,
		).toBe('pr-thread-reply')
		expect(
			routes.redirectFor('flight-rules pr threads 3')?.operationId,
		).toBe('pr-threads')
		expect(routes.redirectFor('flight-rules pr list')?.operationId).toBe(
			'pr',
		)
	})

	it('completes a run that calls check, pr-threads and pr-comment through the operation tool', async () => {
		const { skills, scripted, calls } = runtimeFor(
			{
				turns: [
					[
						operation('check'),
						operation('pr-threads'),
						operation('pr-comment'),
					],
				],
			},
			['check', 'pr-threads', 'pr-comment'],
		)

		const result = await skills.invoke('remediate-review', context, {})

		expect(result).toMatchObject({ status: 'completed', report: 'done' })
		expect(calls.mock.calls.map(([id]) => id)).toEqual([
			'check',
			'pr-threads',
			'pr-comment',
		])
		expect(scripted.denials).toEqual([])
	})
})
