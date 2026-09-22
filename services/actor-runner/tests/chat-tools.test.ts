import { Actor, CALCULATION_MANIFEST, createCalculationActor } from '@avenos/actors'
import { expect, it } from 'vitest'
import { createChatActorTools } from '../src/chat-tools.js'

it('rejects invalid pure computation without an uncertain-write barrier and can recompute a lost result', async () => {
	const host = createChatActorTools({
		actors: [{ manifest: CALCULATION_MANIFEST, create: () => createCalculationActor() }],
		assertActive: async () => {},
		context: (operationId) => ({ operationId })
	})
	const args = {
		operation: 'multiply',
		purpose: 'Cost of workshop kits',
		operands: [
			{ value: '13.40', unit: 'currency:EUR', label: 'Price per kit' },
			{ value: '9', unit: '1', label: 'Kits' }
		]
	}
	const invalid = await host.execute(
		'calculate',
		JSON.stringify({ ...args, purpose_label: 'Not a declared parameter' }),
		crypto.randomUUID()
	)
	expect(JSON.parse(invalid.record).ok).toBe(false)
	expect(invalid.outcome).toBeUndefined()
	const recovered = await host.resolve(crypto.randomUUID(), 'calculate', JSON.stringify(args))
	expect(recovered?.basis).toBe('recomputed')
	expect(JSON.parse(recovered!.result.record)).toMatchObject({
		ok: true,
		outputs: { calculation: { result: { value: '120.6', unit: 'currency:EUR' } } }
	})
})

it('does not infer retry safety from transform mode or an inconsistent pure effect declaration', async () => {
	let calls = 0
	const manifest = {
		id: 'boundary-proof',
		authority: 'ceo.aven',
		namespace: 'fixture',
		version: '1',
		name: 'Boundary proof',
		description: 'Synthetic contract only',
		tags: [],
		methods: [
			{ name: 'unknownTransform', mode: 'transform' as const, description: '', parameters: {} },
			{
				name: 'effect',
				mode: 'effect' as const,
				idempotency: 'pure' as const,
				description: '',
				parameters: {}
			}
		]
	}
	const host = createChatActorTools({
		actors: [
			{
				manifest,
				create: () =>
					new Actor(manifest, {
						unknownTransform: () => {
							calls++
							throw Error('Lost')
						},
						effect: () => {
							calls++
							throw Error('Lost')
						}
					})
			}
		],
		assertActive: async () => {},
		context: (operationId) => ({ operationId })
	})
	for (const name of ['unknownTransform', 'effect']) {
		expect((await host.execute(name, '{}', crypto.randomUUID())).outcome).toBe('uncertain')
		expect(await host.resolve(crypto.randomUUID(), name, '{}')).toBeNull()
	}
	expect(calls).toBe(2)
})
