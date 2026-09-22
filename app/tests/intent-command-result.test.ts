import { expect, test } from 'bun:test'
import { Actor, ActorCommandRejected } from '@avenos/actors'
import { runIntentCommand } from '../src/lib/intents/command-result'

const conflict = {
	code: 'INTENT_VERSION_CONFLICT',
	status: 409,
	retryable: false,
	message: 'Intent version or state changed.'
}

test('a rejected conditional write refreshes once but never retries the mutation', async () => {
	let attempts = 0
	let refreshes = 0
	const actor = new Actor(
		{
			id: 'intent-test',
			name: 'Intent test',
			methods: [{ name: 'change', description: '', parameters: {}, mode: 'effect' }]
		},
		{
			change: () =>
				runIntentCommand(
					async () => {
						attempts++
						throw JSON.stringify(conflict)
					},
					async () => {
						refreshes++
					}
				)
		}
	)
	const result = await actor.deliver('change', {})
	expect(result.outcome).toBeUndefined()
	expect(JSON.parse(result.record).ok).toBe(false)
	expect(result.wire).toContain('Not applied')
	expect(result.wire).toContain('current state has been refreshed')
	expect(attempts).toBe(1)
	expect(refreshes).toBe(1)
})

test('failure to refresh does not turn a known rejection into an unknown write outcome', async () => {
	await expect(
		runIntentCommand(
			async () => {
				throw JSON.stringify(conflict)
			},
			async () => {
				throw Error('Read unavailable')
			}
		)
	).rejects.toBeInstanceOf(ActorCommandRejected)
})

test('unknown errors and generic conflicts remain uncertain; no status-only retry inference', async () => {
	for (const error of [
		Error('Lost acknowledgement'),
		JSON.stringify({ ...conflict, code: 'OTHER_CONFLICT' }),
		JSON.stringify({ ...conflict, status: 500 }),
		JSON.stringify({ ...conflict, retryable: true }),
		JSON.stringify({ ...conflict, message: null }),
		`Upstream said ${JSON.stringify(conflict)}`,
		'null',
		'[]',
		'{}',
		conflict
	]) {
		let refreshes = 0
		await expect(
			runIntentCommand(
				async () => {
					throw error
				},
				async () => {
					refreshes++
				}
			)
		).rejects.toBe(error)
		expect(refreshes).toBe(0)
	}
})

test('a successful command is returned without extra lookup or retry', async () => {
	const receipt = { version: 3 }
	expect(
		await runIntentCommand(
			async () => receipt,
			async () => {
				throw Error('Unexpected refresh')
			}
		)
	).toBe(receipt)
})
