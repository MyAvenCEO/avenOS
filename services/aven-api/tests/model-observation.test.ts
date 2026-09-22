import { expect, test } from 'vitest'
import { ModelObservation, providerFailure } from '../src/lib/server/model-observation.js'

test('timings use a validated parent, preserve unknowns and emit once without content', () => {
	const events: Record<string, unknown>[] = []
	const trace = new ModelObservation(
		'model-1',
		'interactive',
		123,
		'00-11111111111111111111111111111111-2222222222222222-01',
		(e) => {
			events.push(e)
		}
	)
	trace.acquired()
	trace.bytes(100)
	trace.usage({ prompt_tokens: 42, completion_tokens: 8, private: 'never retain this' })
	const timing = trace.finish('ok')
	expect(trace.finish('transport')).toBe(timing)
	expect(events).toHaveLength(1)
	expect(timing.traceId).toBe('11111111111111111111111111111111')
	expect(timing.cachedTokens).toBeNull()
	expect(timing.totalMs).toBeGreaterThan(0)
	expect(JSON.stringify(events)).not.toContain('private')
	expect(JSON.stringify(events)).not.toContain('never retain')
})

test('logging failures cannot break work; untrusted trace context is not reflected', () => {
	const trace = new ModelObservation('model-1', 'work', 10, 'secret words', () => {
		throw Error('sink down')
	})
	expect(trace.finish('capacity').parentSpanId).toBeNull()
	expect(trace.finish('ok').queueMs).toBeNull()
	expect(trace.traceparent).not.toContain('secret')
})

test('recognized provider codes classify context limits; echoed content never escapes', async () => {
	expect(
		await providerFailure(
			Response.json(
				{ error: { code: 'context_length_exceeded', message: 'private' } },
				{ status: 400 }
			)
		)
	).toBe('context-limit')
	expect(
		await providerFailure(
			Response.json({ error: { message: 'context_length_exceeded with secrets' } }, { status: 400 })
		)
	).toBe('invalid-request')
	expect(await providerFailure(new Response('x'.repeat(10000), { status: 429 }))).toBe('capacity')
	expect(await providerFailure(new Response('unknown', { status: 500 }))).toBe('provider-failure')
})

test('flat SGLang context diagnostic is recognized only with an exact numeric exceeded bound', async () => {
	const envelope = {
		object: 'error',
		type: 'BadRequestError',
		code: 400,
		message: "The input (301007 tokens) is longer than the model's context length (262144 tokens)."
	}
	expect(await providerFailure(Response.json(envelope, { status: 400 }))).toBe('context-limit')
	for (const changed of [
		{ message: envelope.message + ' Private input echoed here.' },
		{ message: envelope.message.replace('301007', '123') },
		{ message: envelope.message.replace('301007', '999999999999999999') },
		{ message: envelope.message.replace('262144', '0') },
		{ type: 'OtherError' },
		{ object: 'chat.completion' },
		{ code: '400' }
	])
		expect(await providerFailure(Response.json({ ...envelope, ...changed }, { status: 400 }))).toBe(
			'invalid-request'
		)
	expect(await providerFailure(Response.json(envelope, { status: 500 }))).toBe('provider-failure')
})

test('output reservation can exceed capacity even when the input fits', async () => {
	const message = (limit: string, total: string, input: string, output: string) =>
		`Requested token count exceeds the model's maximum context length of ${limit} tokens. You requested a total of ${total} tokens: ${input} tokens from the input messages and ${output} tokens for the completion. Please reduce the number of tokens in the input messages or the completion to fit within the limit.`
	const envelope = { object: 'error', type: 'BadRequestError', code: 400 }
	const valid = message('262144', '262475', '261963', '512')
	expect(
		await providerFailure(Response.json({ ...envelope, message: valid }, { status: 400 }))
	).toBe('context-limit')
	for (const invalid of [
		valid + ' Private input echoed here.',
		message('262144', '1000', '488', '512'),
		message('262144', '262475', '261963', '1024'),
		message('0', '262475', '261963', '512'),
		message('262144', '999999999999999999', '261963', '512')
	])
		expect(
			await providerFailure(Response.json({ ...envelope, message: invalid }, { status: 400 }))
		).toBe('invalid-request')
	expect(
		await providerFailure(Response.json({ ...envelope, message: valid }, { status: 500 }))
	).toBe('provider-failure')
})
