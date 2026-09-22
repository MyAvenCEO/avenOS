import { expect, test } from 'bun:test'
import type { InputAdmission } from '@avenos/intents/admission'
import { IntentWorkRequestError, RemoteIntentWork } from '@avenos/intents/remote'

const id = () => crypto.randomUUID()
const input = (): InputAdmission => ({
	inputId: id(),
	revision: 1,
	text: 'Record the garden repair plan.',
	originalText: 'Record the garden repair plan.',
	corrections: [],
	target: { kind: 'existing', id: id() },
	locale: 'en-GB',
	timezone: 'Europe/London',
	capturedAt: '2026-04-02T09:00:00Z',
	decisionId: id(),
	confirmed: true,
	references: []
})
const receipt = (i: InputAdmission) => ({
	inputId: i.inputId,
	revision: i.revision,
	contributionId: id(),
	intentId: i.target.kind === 'existing' ? i.target.id : id(),
	intentTitle: 'Garden repairs',
	turnId: id(),
	sequence: 3,
	admittedAt: i.capturedAt
})

test('work admission snapshots the exact input and checks its returned binding', async () => {
	const original = input(),
		accepted = receipt(original)
	const calls: unknown[] = []
	const work = new RemoteIntentWork(async (method, path, body) => {
		calls.push({ method, path, body })
		original.text = 'A later local edit must not alter this admission.'
		return accepted
	})
	expect(await work.admit(original)).toEqual(accepted)
	expect(calls).toMatchObject([
		{ method: 'POST', path: '/input', body: { text: 'Record the garden repair plan.' } }
	])
	for (const patch of [{ inputId: id() }, { revision: 2 }, { intentId: id() }]) {
		const invalid = new RemoteIntentWork(async () => ({ ...accepted, ...patch }))
		await expect(invalid.admit(original)).rejects.toThrow('does not match')
	}
})

test('unknown admission outcomes never replay or change identity', async () => {
	let attempts = 0
	const work = new RemoteIntentWork(async () => {
		attempts++
		throw Error('Acknowledgement lost')
	})
	await expect(work.admit(input())).rejects.toThrow('Acknowledgement lost')
	expect(attempts).toBe(1)
})

test('receipt lookup distinguishes absent receipt from access/transport errors and conflicting revision', async () => {
	const i = input(),
		r = receipt(i)
	expect(await new RemoteIntentWork(async () => r).receipt(i.inputId, 1)).toEqual(r)
	await expect(
		new RemoteIntentWork(async () => ({ ...r, revision: 2 })).receipt(i.inputId, 1)
	).rejects.toThrow('different message')
	expect(
		await new RemoteIntentWork(async () => {
			throw new IntentWorkRequestError('Absent', 'INTENT_NOT_FOUND', 404)
		}).receipt(i.inputId, 1)
	).toBeNull()
	for (const error of [
		new IntentWorkRequestError('Denied', 'AUTHORIZATION_DENIED', 403),
		new IntentWorkRequestError('Route missing', 'ROUTE_NOT_FOUND', 404),
		new IntentWorkRequestError('Changed input', 'INTENT_CONFLICT', 409),
		new IntentWorkRequestError('Disconnected', 'NETWORK_UNAVAILABLE', undefined),
		Error('Offline')
	])
		await expect(
			new RemoteIntentWork(async () => {
				throw error
			}).receipt(i.inputId, 1)
		).rejects.toThrow(error.message)
})

test('work paging rejects mixed Intent records and duplicate turns without hiding them', async () => {
	const intentId = id()
	const turn = {
		turnId: id(),
		intentId,
		contributionId: id(),
		responseId: id(),
		controlRevision: 1,
		stopRequestedAt: null,
		sequence: 5,
		state: 'queued',
		reason: null,
		admittedAt: '2026-04-02T09:00:00Z',
		acceptedAt: null,
		finishedAt: null,
		outputContributionId: null
	}
	const page = {
		turns: [turn],
		hasMore: true,
		nextCursor: 'opaque+cursor',
		observedAt: '2026-04-02T09:00:01Z'
	}
	const calls: string[] = []
	const work = new RemoteIntentWork(async (_method, path) => {
		calls.push(path)
		return page
	})
	expect(await work.turns(intentId, { cursor: 'opaque+cursor', limit: 10 })).toEqual(page)
	expect(calls).toEqual([`/${intentId}/turns?cursor=opaque%2Bcursor&limit=10`])
	for (const turns of [[{ ...turn, intentId: id() }], [turn, turn]])
		await expect(
			new RemoteIntentWork(async () => ({ ...page, turns })).turns(intentId)
		).rejects.toThrow('does not match')
})

test('stop targets an exact response with its original control command and no automatic retry', async () => {
	const intentId = id(),
		turnId = id(),
		command = { commandId: id(), expectedControlRevision: 3 }
	const stopped = {
		intentId,
		turnId,
		controlRevision: 4,
		disposition: 'stopping',
		stopRequestedAt: '2026-04-02T09:00:01Z'
	}
	const calls: unknown[] = []
	const work = new RemoteIntentWork(async (method, path, body) => {
		calls.push({ method, path, body })
		return stopped
	})
	expect(await work.stop(intentId, turnId, command)).toEqual(stopped)
	expect(calls).toEqual([
		{ method: 'POST', path: `/${intentId}/turns/${turnId}/stop`, body: command }
	])
	await expect(
		new RemoteIntentWork(async () => ({ ...stopped, turnId: id() })).stop(intentId, turnId, command)
	).rejects.toThrow('different response')
	await expect(work.stop('../elsewhere', turnId, command)).rejects.toThrow()
	expect(calls).toHaveLength(1)
})
