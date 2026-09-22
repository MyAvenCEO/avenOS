/** Real-provider queue order; no generated response is replaced or delayed by the harness. */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
assert(base)
const models = await fetch(`${base}/models`).then((r) => r.json())
const model = models.data.find((m: any) => /qwen/i.test(m.id))?.id
assert(model)
const output = await mkdtemp('/tmp/aven-routing-priority-')
const evidence: any = {
	synthetic: true,
	model,
	startedAt: new Date().toISOString(),
	passed: false,
	cases: []
}
try {
	for (const parallelism of [1, 3]) {
		const dispatched: string[] = [],
			receipts: any[] = []
		const gateway = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_MAX_PARALLELISM: parallelism,
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: 'proof',
						label: 'Synthetic priority proof',
						baseUrl: base,
						upstreamModel: model,
						profile: 'qwen-tools',
						authMode: 'none',
						capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
					}
				])
			}),
			async (url, options) => {
				const body = JSON.parse(options!.body as string)
				const text = body.messages.at(-1).content
				const serialized = typeof text === 'string' ? text : JSON.stringify(text)
				dispatched.push(
					/"kind":"route"/.test(serialized.replaceAll('\\"', '"'))
						? 'routing'
						: /"kind":"feedback"/.test(serialized.replaceAll('\\"', '"'))
							? 'feedback'
							: 'work'
				)
				return fetch(url, options)
			}
		)!
		const owner = crypto.randomUUID(),
			id = crypto.randomUUID(),
			responseId = crypto.randomUUID()
		const work = () =>
			gateway.complete(
				{
					modelId: 'proof',
					requiredCapabilities: ['text-generation'],
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: 'Give one short sentence about an imaginary pottery workshop. No tools or actions.'
								}
							]
						}
					],
					output: {
						format: 'json',
						name: 'work_note',
						schema: {
							type: 'object',
							additionalProperties: false,
							required: ['sentence'],
							properties: { sentence: { type: 'string' } }
						}
					},
					maxOutputTokens: 256,
					temperature: 0
				},
				undefined,
				{ owner }
			)
		const warm = Array.from({ length: parallelism === 1 ? 1 : 2 }, () => work())
		while (dispatched.length < warm.length) await Bun.sleep(1)
		const queuedWork = Array.from({ length: 2 }, () => work())
		const feedback = gateway.inputDecision(
			{
				kind: 'feedback',
				modelId: 'proof',
				locale: 'en-GB',
				text: 'Your explanation was very useful.',
				recent: [
					{
						role: 'assistant',
						content: 'Sort pottery by glaze and firing temperature.',
						responseId
					}
				]
			},
			owner
		)
		const routeCount = parallelism === 1 ? 4 : 2
		const routes = Array.from({ length: routeCount }, () =>
			gateway.inputDecision(
				{
					kind: 'route',
					modelId: 'proof',
					locale: 'en-GB',
					text: 'Which brush is suitable for glaze? Please answer here.',
					context: { selectedId: id, intents: [{ id, title: 'Pottery workshop' }], recent: [] }
				},
				owner
			)
		)
		const all = await Promise.all([...warm, ...queuedWork, feedback, ...routes])
		for (const result of all)
			receipts.push('receipt' in result ? result.receipt.timing : result.timing)
		assert(
			routes.length &&
				all.every((r) =>
					'output' in r ? r.output.format === 'json' && r.output.value : r.decision
				)
		)
		if (parallelism === 1)
			assert.deepEqual(dispatched.slice(0, 6), [
				'work',
				'routing',
				'routing',
				'routing',
				'work',
				'routing'
			])
		else
			assert.equal(
				dispatched[2],
				'routing',
				'Routing must enter the reserved slot while work is already running'
			)
		assert.equal(dispatched.filter((x) => x === 'feedback').length, 1)
		evidence.cases.push({ parallelism, dispatched, receipts, passed: true })
	}
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(output)
}
