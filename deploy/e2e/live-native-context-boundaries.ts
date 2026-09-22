import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { contextBoundary, template } from './context-boundary-fixture'
import { e2eModelCatalog } from './llm-catalog'
import type { TauriSession } from './tauri-driver'

/** Actual signed-in native IPC → authenticated API → Qwen. The fixture supplies
 * request history, not a generated answer. Ordinary UI hydration is tested separately. */
export async function liveNativeContextBoundaries(session: TauriSession, evidence: any) {
	const base = process.env.TEST_DOCUMENT_PROVIDER_BASE_URL?.replace(/\/$/, '')
	const model = process.env.TEST_DOCUMENT_PROVIDER_MODEL
	assert(base && model && process.env.E2E_LIVE_CHAT === 'true')
	const descriptor = (await fetch(base + '/models').then((r) => r.json())).data.find(
		(m: any) => m.id === model
	)
	assert(descriptor && Number.isSafeInteger(descriptor.max_model_len))
	const capacity = descriptor.max_model_len,
		reserve = 512
	assert(capacity >= 8192 && capacity <= 1_048_576)
	const catalog = e2eModelCatalog(process.env).find((m) => m.capabilities.includes('streaming'))!
	const atBoundary = contextBoundary(base, model, capacity)
	const invoke = async (request: unknown) => {
		await session.execute(
			`window.__nativeCapacity = null;
			window.__TAURI_INTERNALS__.invoke('llm_openai_complete', {request: arguments[0]})
			.then(value => window.__nativeCapacity={value}, failure => window.__nativeCapacity={failure});`,
			[request]
		)
		const end = Date.now() + 300_000
		while (Date.now() < end) {
			const result = await session.execute<any>('return window.__nativeCapacity')
			if (result) return result
			await sleep(250)
		}
		throw Error('Native context-capacity request timed out')
	}
	evidence.nativeContext = {
		capacity,
		model,
		catalogModel: catalog.id,
		runs: [],
		scope:
			'Authenticated native request transport, not typing 114 messages in the UI or a token-budget policy.'
	}
	for (const scenario of [
		{ name: 'at-context-edge', target: capacity - reserve - 96, overflow: false },
		{ name: 'output-reservation-overflow', target: capacity - 160, overflow: true },
		{ name: 'actual-context-overflow', target: capacity + 256, overflow: true }
	]) {
		const { messages, tokens } = await atBoundary(scenario.target)
		const began = performance.now()
		const result = await invoke({
			model: catalog.id,
			messages,
			stream: false,
			max_tokens: reserve,
			temperature: 0,
			chat_template_kwargs: template,
			response_format: { type: 'json_object' }
		})
		const run = {
			...scenario,
			tokens,
			reservedTotalTokens: tokens + reserve,
			durationMs: performance.now() - began,
			...result
		}
		evidence.nativeContext.runs.push(run)
		if (scenario.overflow) {
			const error = typeof result.failure === 'string' ? JSON.parse(result.failure) : result.failure
			assert.equal(error?.code, 'LLM_CONTEXT_LIMIT')
			assert.equal(error?.status, 422)
			assert.equal(error?.retryable, false)
		} else {
			assert(!result.failure)
			assert.equal(result.value.choices[0].finish_reason, 'stop')
			assert.deepEqual(JSON.parse(result.value.choices[0].message.content), {
				museumCode: 'MOSS-ORBIT',
				room: 'East Atrium',
				weekday: 'Tuesday',
				invitationSent: false
			})
			assert(Math.abs(result.value.usage.prompt_tokens - tokens) <= 8)
			assert.equal(result.value.aven.providerReportedModel, model)
		}
	}
	const recovery = await invoke({
		model: catalog.id,
		messages: [{ role: 'user', content: 'Fictional transport check: reply with exactly READY.' }],
		max_tokens: reserve,
		chat_template_kwargs: template
	})
	evidence.nativeContext.recovery = recovery
	assert(!recovery.failure)
	assert.equal(recovery.value.choices[0].message.content.trim(), 'READY')
	evidence.nativeContext.passed = true
}
