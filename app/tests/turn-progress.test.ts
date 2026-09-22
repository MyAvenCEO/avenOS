import { expect, test } from 'bun:test'
import { type TurnProgress, turnProgressSchema } from '@avenos/intents/turn-progress'

const progress = (): TurnProgress => ({
	turnId: crypto.randomUUID(),
	revision: 3,
	state: 'running',
	updatedAt: '2026-04-02T09:00:00Z',
	observedAt: '2026-04-02T09:00:01Z',
	leaseExpiresAt: '2026-04-02T09:00:30Z',
	operation: {
		ordinal: 0,
		kind: 'model',
		phase: 'answer',
		state: 'running',
		startedAt: 1775120400000,
		replayed: false
	},
	steps: []
})

test('public turn progress accepts bounded execution metadata, not private payloads', () => {
	const p = progress()
	p.steps = [p.operation!]
	expect(turnProgressSchema.parse(p)).toEqual(p)
	for (const extra of [
		{ runId: crypto.randomUUID() },
		{ arguments: 'private' },
		{ prompt: 'private' },
		{ journal: [] }
	])
		expect(turnProgressSchema.safeParse({ ...p, ...extra }).success).toBe(false)
	for (const extra of [
		{ result: 'private' },
		{ reasoning: 'private' },
		{ durationMs: -1 },
		{ name: 'x'.repeat(129) }
	])
		expect(
			turnProgressSchema.safeParse({ ...p, operation: { ...p.operation, ...extra } }).success
		).toBe(false)
	expect(
		turnProgressSchema.safeParse({
			...p,
			steps: Array.from({ length: 25 }, (_, ordinal) => ({ ...p.operation, ordinal }))
		}).success
	).toBe(false)
	expect(turnProgressSchema.safeParse({ ...p, steps: [p.operation, p.operation] }).success).toBe(
		false
	)
})

test('a lapsed execution lease is retained as uncertainty, never converted into a failure or zero timing', () => {
	const p = progress()
	p.leaseExpiresAt = '2026-04-02T08:59:30Z'
	p.operation = { ...p.operation!, state: 'reconciling', replayed: true, basis: 'receipt-check' }
	p.steps = [p.operation]
	expect(turnProgressSchema.parse(p).state).toBe('running')
	expect(turnProgressSchema.parse(p).operation?.durationMs).toBeUndefined()
	p.operation = { ...p.operation, state: 'completed', durationMs: 0.42 }
	p.steps = [p.operation]
	expect(turnProgressSchema.parse(p).operation?.durationMs).toBe(0.42)
})
