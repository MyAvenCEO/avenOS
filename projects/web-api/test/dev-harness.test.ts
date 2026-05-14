import { expect, test } from 'bun:test'

import {
	createDevHarness,
	runShell,
	normalizeTinfoilBaseUrl,
	resolveProviderConfig,
	setTinfoilClientFactoryForTests
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
		apiKey: 'tk_test',
		responseFormat: 'json_object'
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
		apiKey: 'local',
		responseFormat: 'text'
	})
})

test('resolveProviderConfig accepts explicit OpenAI response format override', () => {
	const config = resolveProviderConfig({
		JAENSEN_OPENAI_BASE_URL: 'http://box:8000/v1/',
		JAENSEN_OPENAI_API_KEY: 'local',
		JAENSEN_OPENAI_MODEL: 'google/gemma-4-26b-a4b',
		JAENSEN_OPENAI_RESPONSE_FORMAT: 'json_schema'
	} as EnvLike)

	expect(config.responseFormat).toBe('json_schema')
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
		)) as unknown as typeof fetch

	try {
		const harness = createDevHarness({
			provider: 'openai',
			model: 'demo-model',
			baseUrl: 'http://example.test/v1',
			apiKey: 'local',
			responseFormat: 'text'
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
	setTinfoilClientFactoryForTests(() => ({
		ready: async () => {},
		chat: {
			completions: {
				create: async () => ({
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
				})
			}
		}
	}))
	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/dispatcher', { role: 'jaensen-conversation-dispatcher' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-dispatcher' })).resolves.toEqual({
			type: 'create_intent',
			title: 'Repo review',
			initialGoal: 'Please review this repo',
			reason: 'New user goal'
		})
	} finally {
		setTinfoilClientFactoryForTests(undefined)
	}
})

test('createDevHarness normalizes intent summary and actions from root response', async () => {
	setTinfoilClientFactoryForTests(() => ({
		ready: async () => {},
		chat: {
			completions: {
				create: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									summary: 'Starting review',
									actions: [{ type: 'reply_user', message: 'Starting review' }]
								})
							}
						}
					]
				})
			}
		}
	}))
	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/intents/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			summary: 'Starting review',
			events: undefined,
			actions: [{ type: 'reply_user', message: 'Starting review' }]
		})
	} finally {
		setTinfoilClientFactoryForTests(undefined)
	}
})

test('createDevHarness warns when recovering root-level intent action', async () => {
	const originalWarn = console.warn
	const warnings: unknown[][] = []
	console.warn = (...args: unknown[]) => {
		warnings.push(args)
	}
	setTinfoilClientFactoryForTests(() => ({
		ready: async () => {},
		chat: {
			completions: {
				create: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({ type: 'reply_user', message: 'Starting review' })
							}
						}
					]
				})
			}
		}
	}))

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/intents/intent-123', { role: 'jaensen-conversation-intent' })
		await session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })
		expect(warnings).toHaveLength(1)
		expect(String(warnings[0]?.[0])).toContain('Recovered intent action from malformed root-level model output')
	} finally {
		setTinfoilClientFactoryForTests(undefined)
		console.warn = originalWarn
	}
})

test('createDevHarness derives intent actions from event-shaped responses', async () => {
	setTinfoilClientFactoryForTests(() => ({
		ready: async () => {},
		chat: {
			completions: {
				create: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
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
				})
			}
		}
	}))

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/intents/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			summary: undefined,
			events: [{ eventType: 'event', event: { type: 'ask_user', payload: { question: 'Which account should I check?' } } }],
			actions: [{ type: 'ask_user', question: 'Which account should I check?' }]
		})
	} finally {
		setTinfoilClientFactoryForTests(undefined)
	}
})

test('createDevHarness converts intent.confirmation_requested events into ask_user actions', async () => {
	setTinfoilClientFactoryForTests(() => ({
		ready: async () => {},
		chat: {
			completions: {
				create: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
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
				})
			}
		}
	}))

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/intents/intent-123', { role: 'jaensen-conversation-intent' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-intent' })).resolves.toEqual({
			summary: undefined,
			events: [{ eventType: 'event', event: { type: 'intent.confirmation_requested', payload: { clarification: 'Would you like me to send this?' } } }],
			actions: [{ type: 'ask_user', question: 'Would you like me to send this?' }]
		})
	} finally {
		setTinfoilClientFactoryForTests(undefined)
	}
})

test('createDevHarness uses Tinfoil SDK for tinfoil provider', async () => {
	const calls: unknown[] = []
	setTinfoilClientFactoryForTests((apiKey) => ({
		ready: async () => {
			calls.push({ type: 'ready', apiKey })
		},
		chat: {
			completions: {
				create: async (input) => {
					calls.push({ type: 'create', apiKey, input })
					return {
						choices: [{ message: { content: '{"ok":true}' } }]
					}
				}
			}
		}
	}))

	try {
		const harness = createDevHarness({
			provider: 'tinfoil',
			model: 'glm-5-1',
			baseUrl: 'https://api.tinfoil.sh/v1',
			apiKey: 'tk_test',
			responseFormat: 'json_object'
		})

		const session = await harness.session('actor/dispatcher', { role: 'jaensen-conversation-dispatcher' })
		await expect(session.prompt('Return JSON', { schema: {}, role: 'jaensen-conversation-dispatcher' })).resolves.toEqual({ ok: true })
		expect(calls).toHaveLength(2)
		expect(calls[0]).toEqual({ type: 'ready', apiKey: 'tk_test' })
		expect(calls[1]).toEqual({
			type: 'create',
			apiKey: 'tk_test',
			input: {
				model: 'glm-5-1',
				response_format: { type: 'json_object' },
				messages: [
					{ role: 'system', content: expect.any(String) },
					{ role: 'user', content: 'Return JSON' }
				]
			}
		})
	} finally {
		setTinfoilClientFactoryForTests(undefined)
	}
})

test('runShell aborts child process when signal is aborted', async () => {
	const controller = new AbortController()
	const promise = runShell('sleep 10', {
		signal: controller.signal,
		timeoutMs: 5_000
	})
	setTimeout(() => controller.abort(new Error('abort requested')), 50)
	const result = await promise
	expect(result.aborted).toBe(true)
	expect(result.timedOut).toBe(false)
	expect(result.exitCode).not.toBe(0)
}, 5_000)

test('runShell times out long-running commands', async () => {
	const result = await runShell('sleep 10', { timeoutMs: 50 })
	expect(result.timedOut).toBe(true)
	expect(result.aborted).toBe(false)
	expect(result.exitCode).not.toBe(0)
}, 5_000)