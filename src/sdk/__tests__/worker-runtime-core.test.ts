import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { claudeBuiltInTools } from '../claude-builtin-tools.js'
import {
	CapabilityToolDeniedError,
	workerRunProtocol,
} from '../worker-runtime-core.js'

describe('claudeBuiltInTools', () => {
	it('maps each enforceable capability to its Claude built-in tools', () => {
		expect(claudeBuiltInTools.toolsFor('read')).toEqual([
			'Glob',
			'Grep',
			'Read',
		])
		expect(claudeBuiltInTools.toolsFor('edit')).toEqual(['Write', 'Edit'])
		expect(claudeBuiltInTools.toolsFor('shell')).toEqual(['Bash'])
		expect(claudeBuiltInTools.toolsFor('web')).toEqual([
			'WebSearch',
			'WebFetch',
		])
		expect(claudeBuiltInTools.toolsFor('spawn')).toEqual([])
		expect(claudeBuiltInTools.toolsFor('ask')).toEqual([])
	})
})

describe('workerRunProtocol.executionFailure', () => {
	it('maps cancellation, capability denial and other failures', () => {
		const aborted = AbortSignal.abort()
		const live = new AbortController().signal
		expect(
			workerRunProtocol.executionFailure(new Error('x'), aborted).code,
		).toBe('CANCELLED')
		expect(
			workerRunProtocol.executionFailure(
				new CapabilityToolDeniedError({
					toolName: 'write_file',
					capability: 'edit',
				}),
				live,
			).code,
		).toBe('CAPABILITY_DENIED')
		expect(
			workerRunProtocol.executionFailure(
				new CapabilityToolDeniedError({ toolName: 'x' }),
				live,
			).code,
		).toBe('CAPABILITY_UNKNOWN')
		expect(
			workerRunProtocol.executionFailure(new Error('boom'), live),
		).toMatchObject({
			code: 'EXECUTION_FAILED',
			message: 'boom',
		})
	})
})

describe('neutral worker modules', () => {
	it('import nothing from LangChain, Deep Agents or the deepagents binding', () => {
		for (const file of [
			'../worker-runtime-core.ts',
			'../claude-builtin-tools.ts',
		]) {
			const source = readFileSync(new URL(file, import.meta.url), 'utf8')
			expect(source).not.toMatch(
				/from "(deepagents|langchain|@langchain\/[^"]*|\.\/deepagents\/[^"]*)"/,
			)
		}
	})
})
