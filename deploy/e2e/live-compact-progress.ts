/** Real Qwen, production stream/engine/Actor and Svelte progress. Synthetic inputs only. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
assert(base, 'Set LIVE_LLM_BASE_URL to the real Qwen provider')
const model = (await fetch(`${base}/models`).then((r) => r.json())).data.find((m: any) =>
	/qwen/i.test(m.id)
)?.id
assert(model)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'deepseek/deepseek-v4-flash-0731',
				label: 'Synthetic progress proof',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	})
)!
const out = await mkdtemp('/tmp/aven-compact-progress-'),
	token = randomUUID()
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	cases: [],
	fingerprints: {},
	scope:
		'Browser production UI and real Qwen gateway/engine/calculation Actor; not native authentication or acoustic voice.'
}
for (const path of [
	'app/src/lib/chat/ToolCalls.svelte',
	'app/src/lib/chat/follow-bottom.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/model-metrics.ts',
	'deploy/e2e/live-compact-progress.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const server = Bun.serve({
	hostname: '127.0.0.1',
	port: 0,
	idleTimeout: 255,
	async fetch(request) {
		const headers = {
			'access-control-allow-origin': 'http://127.0.0.1:1457',
			'access-control-allow-headers': 'authorization,content-type'
		}
		if (request.method === 'OPTIONS') return new Response(null, { headers })
		if (request.headers.get('authorization') !== `Bearer ${token}`)
			return new Response(null, { status: 403, headers })
		try {
			const response = await gateway.openAiChatCompletion(await request.json(), request.signal, {
				owner: 'synthetic-compact-progress'
			})
			return new Response(response.body, {
				status: response.status,
				headers: { ...Object.fromEntries(response.headers), ...headers }
			})
		} catch (error) {
			return Response.json({ error: String(error) }, { status: 502, headers })
		}
	}
})
const browser = await chromium.launch({ headless: true })
console.log(out)
try {
	const page = await browser.newPage({ viewport: { width: 1000, height: 750 } })
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto('http://127.0.0.1:1457/dashboard')
	await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
	await page.evaluate(
		async ({ endpoint, token, root }) => {
			const { mount } = await import('/@id/svelte')
			const { Chat } = await import('/src/lib/chat/chat.svelte.ts')
			const { createGatewayModelStream } = await import('/@id/@avenos/chat-engine/gateway')
			const { openAiGatewayRequest } = await import('/src/lib/chat/redpill.ts')
			const { createCalculationActor } = await import(
				`/@fs/${root}/libs/aven-actors/src/calculation.ts`
			)
			const { default: View } = await import('/src/lib/chat/ToolCalls.svelte')
			const stream = createGatewayModelStream({
				request: openAiGatewayRequest,
				open: async (request: unknown, signal: AbortSignal) => {
					const response = await fetch(endpoint, {
						method: 'POST',
						signal,
						headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
						body: JSON.stringify(request)
					})
					if (!response.ok || !response.body) throw Error(`Real gateway failed: ${response.status}`)
					return (async function* () {
						const reader = response.body!.getReader(),
							decoder = new TextDecoder()
						try {
							for (;;) {
								const part = await reader.read()
								if (part.done) break
								yield decoder.decode(part.value, { stream: true })
							}
						} finally {
							await reader.cancel()
						}
					})()
				}
			})
			const actor = createCalculationActor()
			const chat = new Chat(
				{},
				{
					specs: actor.manifest.methods.map(({ name, description, parameters }: any) => ({
						name,
						description,
						parameters
					})),
					run: (name: string, args: string) => actor.deliver(name, JSON.parse(args))
				},
				stream
			)
			const w = window as any
			w.compactChat = chat
			const host = document.createElement('section')
			host.id = 'compact-proof'
			host.style.cssText =
				'position:fixed;inset:24px;z-index:100000;background:#faf8ef;color:#223047;overflow:auto;padding:16px'
			document.body.append(host)
			mount(View, {
				target: host,
				props: {
					get calls() {
						return chat.turns.at(-1)?.calls ?? []
					},
					get modelRequests() {
						return chat.turns.at(-1)?.modelRequests ?? []
					},
					get modelRequestCount() {
						return chat.turns.at(-1)?.modelRequestCount
					},
					get active() {
						return chat.streaming
					},
					get startedAt() {
						return chat.turns.at(-1)?.startedAt
					},
					get durationMs() {
						return chat.turns.at(-1)?.durationMs
					},
					get modelActivity() {
						return chat.modelActivity
					},
					get recovering() {
						return chat.recoveringStream
					}
				}
			})
		},
		{ endpoint: `http://127.0.0.1:${server.port}/chat`, token, root: process.cwd() }
	)
	for (const [text, answer] of [
		[
			'Für einen erfundenen Malkurs: 7 Pinselsets zu 8,40 EUR und 3 Papierpakete zu 6,25 EUR. Berechne beide Teilsummen und die Gesamtkosten mit dem Rechenwerkzeug.',
			'77.55'
		],
		[
			'For a fictional garden group, calculate exactly: five seed kits at 4.70 EUR each and two pots at 9.30 EUR each. Show both subtotals and the combined cost using the calculator.',
			'42.1'
		]
	]) {
		await page.evaluate((text) => {
			const w = window as any
			w.compactDone = false
			w.compactChat.send(text).finally(() => {
				w.compactDone = true
			})
		}, text)
		const host = page.locator('#compact-proof'),
			details = host.locator('details.tool-calls')
		await expect(host.getByLabel('Current agent step', { exact: true })).toBeVisible({
			timeout: 15000
		})
		await details.evaluate((el) => {
			;(el as HTMLDetailsElement).open = false
		})
		assert(
			(await details.boundingBox())!.height <= 45,
			'Collapsed progress must remain one compact row'
		)
		await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(0)
		const initialTime = await host.locator('.timing').textContent()
		await expect.poll(() => host.locator('.timing').textContent()).not.toBe(initialTime)
		await details.locator(':scope > summary').click()
		await expect(host.locator('li[data-status="running"]')).toHaveCount(1)
		await expect(host.getByLabel('Current step duration', { exact: true })).toBeVisible()
		await page.waitForFunction(() => (window as any).compactDone, undefined, { timeout: 240000 })
		const turn = await page.evaluate(() => {
			const chat = (window as any).compactChat
			if (chat.failure) throw Error(chat.failure)
			return JSON.parse(JSON.stringify(chat.turns.at(-1)))
		})
		const run = {
			text,
			turn,
			compact: false,
			chronological: false,
			liveTiming: true,
			failedCalls: turn.calls.filter((c: any) => c.status === 'failed').length
		}
		evidence.cases.push(run)
		assert(
			turn.calls.some(
				(c: any) => c.name === 'calculate' && c.status === 'completed' && c.result.includes(answer)
			)
		)
		// Recoverable tool failures are real history too; don't hide them or rerun
		// until the provider happens to produce a clean-looking trace.
		await expect(host.locator('li[data-step-kind="tool"][data-status="failed"]')).toHaveCount(
			run.failedCalls
		)
		assert(turn.modelRequests.every((m: any) => m.startedAt > 0 && m.durationMs > 0))
		await expect(host.getByLabel('Current agent step', { exact: true })).toHaveCount(0)
		const expected = [
			...turn.calls.map((v: any) => ({ kind: 'tool', v })),
			...turn.modelRequests.map((v: any) => ({ kind: 'model', v }))
		].sort((a, b) => a.v.startedAt - b.v.startedAt)
		assert.deepEqual(
			await host
				.locator('details.tool-calls > ol > li')
				.evaluateAll((els) => els.map((el) => el.getAttribute('data-step-kind'))),
			expected.map((e) => e.kind)
		)
		assert((await host.getByRole('article').count()) >= 1)
		await page.screenshot({ path: `${out}/expanded-${evidence.cases.length}.png` })
		await details.locator(':scope > summary').click()
		await expect(host.getByRole('article').filter({ visible: true })).toHaveCount(0)
		assert((await details.boundingBox())!.height <= 45)
		await page.screenshot({ path: `${out}/collapsed-${evidence.cases.length}.png` })
		run.compact = true
		run.chronological = true
	}
	assert.deepEqual(errors, [])
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	await browser.close()
	server.stop(true)
}
console.log('PASS compact, chronological progress with real Qwen', out)
