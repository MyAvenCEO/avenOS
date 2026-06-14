import { describe, expect, test } from 'bun:test'
import { normalizeSidecarError } from '../src/lib/agent-sidecar/errors'
import { narrowSidecarEvent } from '../src/lib/agent-sidecar/events'
import type { SidecarEnvelope } from '../src/lib/agent-sidecar/types'

function evt(method: string, event: Record<string, unknown>): SidecarEnvelope {
	return { v: 1, kind: 'event', method, event }
}

describe('narrowSidecarEvent', () => {
	test('narrows agent.run.started', () => {
		const out = narrowSidecarEvent(
			evt('agent.run.started', {
				identityId: 'spark',
				messageId: 'm1',
				replyId: 'r1',
				runId: 'run1'
			})
		)
		expect(out).toEqual({
			type: 'run.started',
			identityId: 'spark',
			messageId: 'm1',
			replyId: 'r1',
			runId: 'run1'
		})
	})

	test('narrows agent.message.completed', () => {
		const out = narrowSidecarEvent(
			evt('agent.message.completed', {
				replyId: 'r1',
				text: 'done',
				runId: 'run1',
				finishReason: 'completed'
			})
		)
		expect(out).toEqual({
			type: 'message.completed',
			replyId: 'r1',
			text: 'done',
			runId: 'run1',
			finishReason: 'completed'
		})
	})

	test('narrows agent.tool.completed with ok flag', () => {
		const out = narrowSidecarEvent(
			evt('agent.tool.completed', { replyId: 'r1', toolId: 't1', label: 'todos', ok: true })
		)
		expect(out).toEqual({
			type: 'tool.completed',
			replyId: 'r1',
			toolId: 't1',
			label: 'todos',
			ok: true
		})
	})

	test('narrows humanPrompt.created', () => {
		const out = narrowSidecarEvent(
			evt('humanPrompt.created', {
				replyId: 'r1',
				promptId: 'p1',
				title: 'Confirm',
				body: 'Delete?'
			})
		)
		expect(out).toMatchObject({
			type: 'humanPrompt.created',
			promptId: 'p1',
			title: 'Confirm',
			body: 'Delete?'
		})
	})

	test('narrows runtime.health (no replyId required)', () => {
		const out = narrowSidecarEvent(evt('runtime.health', { status: 'ready' }))
		expect(out).toEqual({ type: 'runtime.health', status: 'ready', message: undefined })
	})

	test('drops events missing a required replyId', () => {
		expect(narrowSidecarEvent(evt('agent.message.completed', { text: 'x' }))).toBeUndefined()
	})

	test('drops unknown methods', () => {
		expect(narrowSidecarEvent(evt('something.else', { replyId: 'r1' }))).toBeUndefined()
	})

	test('drops non-event envelopes', () => {
		expect(narrowSidecarEvent({ v: 1, kind: 'response', id: 'x', result: {} })).toBeUndefined()
		expect(narrowSidecarEvent(undefined)).toBeUndefined()
	})
})

describe('normalizeSidecarError', () => {
	test('preserves a structured sidecar error', () => {
		const out = normalizeSidecarError({
			code: 'agent_not_found',
			message: 'nope',
			retryable: false,
			data: { agentId: 'x' }
		})
		expect(out).toEqual({
			code: 'agent_not_found',
			message: 'nope',
			retryable: false,
			data: { agentId: 'x' }
		})
	})

	test('preserves the retryable flag', () => {
		const out = normalizeSidecarError({ code: 'timeout', message: 'slow', retryable: true })
		expect(out.retryable).toBe(true)
	})

	test('falls back for a plain Error', () => {
		const out = normalizeSidecarError(new Error('boom'))
		expect(out).toEqual({ code: 'internal_error', message: 'boom', retryable: false })
	})

	test('falls back for an opaque string', () => {
		const out = normalizeSidecarError('something failed')
		expect(out).toEqual({ code: 'internal_error', message: 'something failed', retryable: false })
	})
})
