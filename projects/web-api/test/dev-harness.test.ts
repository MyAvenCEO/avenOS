import { expect, test } from 'bun:test'

import {
	createDevHarness,
	normalizeTinfoilBaseUrl,
	resolveProviderConfig
} from '../src/dev-harness'

type EnvLike = Record<string, string | undefined>

test('resolveProviderConfig rejects ambiguous provider configuration', () => {
	expect(() =>
		resolveProviderConfig({
			JAENSEN_TINFOIL_API_KEY: 'tk_test',
			JAENSEN_OPENAI_BASE_URL: 'http://box:8000/v1'
		} as EnvLike)
	).toThrow('Configure exactly one provider prefix')
})

test('resolveProviderConfig normalizes tinfoil configuration', () => {
	const config = resolveProviderConfig({
		JAENSEN_TINFOIL_API_KEY: 'tk_test',
		JAENSEN_TINFOIL_BASE_URL: 'https://api.tinfoil.sh'
	} as EnvLike)

	expect(config).toEqual({
		provider: 'tinfoil',
		model: 'glm-5-1',
		baseUrl: 'https://api.tinfoil.sh/v1',
		apiKey: 'tk_test'
	})
})

test('resolveProviderConfig selects openai-compatible configuration', () => {
	const config = resolveProviderConfig({
		JAENSEN_OPENAI_BASE_URL: 'http://box:8000/v1/',
		JAENSEN_OPENAI_API_KEY: 'local',
		JAENSEN_OPENAI_MODEL: 'minimax-m2.7-nvfp4'
	} as EnvLike)

	expect(config).toEqual({
		provider: 'openai',
		model: 'minimax-m2.7-nvfp4',
		baseUrl: 'http://box:8000/v1',
		apiKey: 'local'
	})
})

test('normalizeTinfoilBaseUrl appends v1 only once', () => {
	expect(normalizeTinfoilBaseUrl('https://api.tinfoil.sh')).toBe('https://api.tinfoil.sh/v1')
	expect(normalizeTinfoilBaseUrl('https://api.tinfoil.sh/v1/')).toBe('https://api.tinfoil.sh/v1')
})

test('createDevHarness parses JSON model responses', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [{ message: { content: '```json\n{"ok":true,"value":1}\n```' } }]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'openai',
			model: 'demo-model',
			baseUrl: 'http://example.test/v1',
			apiKey: 'local'
		})

		const session = await harness.session('actor/dispatcher', { role: 'jaensen-conversation-dispatcher' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-dispatcher' })).resolves.toEqual({
			ok: true,
			value: 1
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('createDevHarness unwraps dispatcher decision wrappers', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								decision: {
									title: 'Repo review',
									goal: 'Please review this repo',
									reason: 'New user goal'
								}
							})
						}
					}
				]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test'
		})

		const session = await harness.session('actor/dispatcher', { role: 'jaensen-conversation-dispatcher' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-dispatcher' })).resolves.toEqual({
			type: 'create_intent',
			title: 'Repo review',
			initialGoal: 'Please review this repo',
			reason: 'New user goal'
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('createDevHarness synthesizes required intent state from root response', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								intentId: 'intent-123',
								title: 'My intent',
								goal: 'Help the user',
								actions: [{ type: 'reply_user', message: 'Starting review' }]
							})
						}
					}
				]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test'
		})

		const session = await harness.session('actor/intent/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			state: {
				intentId: 'intent-123',
				title: 'My intent',
				goal: 'Help the user',
				status: 'active',
				summary: '',
				pendingSkillCalls: {}
			},
			events: undefined,
			actions: [{ type: 'reply_user', message: 'Starting review' }]
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('createDevHarness warns when recovering root-level intent action', async () => {
	const originalFetch = globalThis.fetch
	const originalWarn = console.warn
	const warnings: unknown[][] = []
	console.warn = (...args: unknown[]) => {
		warnings.push(args)
	}
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								intentId: 'intent-123',
								title: 'My intent',
								goal: 'Help the user',
								type: 'reply_user',
								message: 'Starting review'
							})
						}
					}
				]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test'
		})

		const session = await harness.session('actor/intent/intent-123', { role: 'jaensen-conversation-intent' })
		await session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })
		expect(warnings).toHaveLength(1)
		expect(String(warnings[0]?.[0])).toContain('Recovered intent action from malformed root-level model output')
	} finally {
		globalThis.fetch = originalFetch
		console.warn = originalWarn
	}
})

test('createDevHarness derives intent actions from event-shaped responses', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								intentId: 'intent-123',
								title: 'My intent',
								goal: 'Help the user',
								events: [
									{
										eventType: 'event',
										event: {
											type: 'ask_user',
											payload: { question: 'Which account should I check?' }
										}
									}
								]
							})
						}
					}
				]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test'
		})

		const session = await harness.session('actor/intent/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			state: {
				intentId: 'intent-123',
				title: 'My intent',
				goal: 'Help the user',
				status: 'waiting_for_user',
				summary: '',
				pendingSkillCalls: {}
			},
			events: [{ eventType: 'event', event: { type: 'ask_user', payload: { question: 'Which account should I check?' } } }],
			actions: [{ type: 'ask_user', question: 'Which account should I check?' }]
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test('createDevHarness converts intent.confirmation_requested events into ask_user actions', async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								intentId: 'intent-123',
								title: 'My intent',
								goal: 'Help the user',
								events: [
									{
										eventType: 'event',
										event: {
											type: 'intent.confirmation_requested',
											payload: { clarification: 'Would you like me to send this?' }
										}
									}
								]
							})
						}
					}
				]
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)) as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test'
		})

		const session = await harness.session('actor/intent/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			state: {
				intentId: 'intent-123',
				title: 'My intent',
				goal: 'Help the user',
				status: 'waiting_for_user',
				summary: '',
				pendingSkillCalls: {}
			},
			events: [{ eventType: 'event', event: { type: 'intent.confirmation_requested', payload: { clarification: 'Would you like me to send this?' } } }],
			actions: [{ type: 'ask_user', question: 'Would you like me to send this?' }]
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})