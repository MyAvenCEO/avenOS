import { ACTOR_RUN_PROTOCOL, type PlanRunStartRequest, resourceId } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import { MemoryPlanRunner, PlanRunConflict } from '../src/memory-runner.js'

const request = (): PlanRunStartRequest => ({
	protocol: ACTOR_RUN_PROTOCOL,
	requestId: crypto.randomUUID(),
	idempotencyKey: 'stable-start-key',
	requestedAt: new Date().toISOString(),
	skillRef: resourceId({
		authority: 'ceo.aven',
		kind: 'skill',
		namespace: 'docs.ingest',
		name: 'document-ingest',
		version: '1'
	}),
	executionEnvironment: 'server',
	ingredients: [{ predicate: 'ceo.aven.docs.document(document_1)' }],
	goals: ['ceo.aven.docs.document(document_1)'],
	parameters: {},
	security: {
		principal: {
			subjectId: '3f7b0f1e-7850-4902-a7b0-093f8604a0dd',
			kind: 'user',
			assurance: ['passkey'],
			sessionId: 'session-1'
		},
		access: {},
		establishedBy: 'test',
		authorizedAt: new Date().toISOString()
	}
})

describe('memory plan runner protocol reference', () => {
	test('replays one logical start while allowing a new request attempt ID', async () => {
		const runner = new MemoryPlanRunner()
		const firstRequest = { ...request(), parameters: { quality: 'standard', locale: 'de' } }
		const first = await runner.start(firstRequest)
		const replay = await runner.start({
			...request(),
			parameters: { locale: 'de', quality: 'standard' }
		})
		expect(replay.runId).toBe(first.runId)
	})

	test('does not let an idempotency key change its material command', async () => {
		const runner = new MemoryPlanRunner()
		await runner.start(request())
		await expect(
			runner.start({
				...request(),
				goals: ['ceo.aven.docs.content_description(document_1)']
			})
		).rejects.toBeInstanceOf(PlanRunConflict)
	})
})
