/** First-call calibration only. Never dispatches a model-selected action. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import type { ChatMessage, ToolSpec } from '@avenos/chat-engine/model'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const path = process.argv[2],
	base = process.env.LIVE_LLM_BASE_URL,
	model = process.env.LIVE_LLM_MODEL
assert(
	path && base && model && /qwen/i.test(model),
	'Supply synthetic dispatcher evidence and real Qwen.'
)
const bytes = await readFile(path),
	source = JSON.parse(bytes.toString())
assert(source.synthetic === true && source.studioInputs?.length)
const original = source.studioInputs[0] as {
	messages: ChatMessage[]
	tools: ToolSpec[]
	options: any
}
assert(original.messages.length === 3 && original.messages[2]?.role === 'user')
const tools = original.tools
const variants =
	process.env.TOOL_SELECTION_EXPERIMENT === 'reasoning'
		? ['non-reasoning', 'reasoning']
		: process.env.TOOL_SELECTION_EXPERIMENT === 'registry-guidance'
			? ['baseline', 'manifest-owned']
			: ['baseline', 'inventory']
// Older captured fixtures retained the caller's options before the live host
// applied these defaults. Explicitly match that host rather than accidentally
// changing reasoning while claiming to compare only a prompt reminder.
const effectiveOptions = {
	...original.options,
	max_tokens: original.options?.max_tokens ?? 2048,
	thinking: original.options?.thinking ?? false
}
const directory = await mkdtemp('/tmp/aven-live-tool-selection-')
const evidence: any = {
	synthetic: true,
	completed: false,
	sourcePath: path,
	sourceHash: createHash('sha256').update(bytes).digest('hex'),
	model,
	effectiveOptions,
	scriptHash: createHash('sha256')
		.update(await readFile(import.meta.path))
		.digest('hex'),
	runs: [],
	scope:
		'Actual captured synthetic first request plus independent multilingual requests, real gateway/Qwen. No tool execution, schema-completeness, native or full-turn qualification.'
}
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'selection-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'selection-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
		yield decoder.decode()
	}
})
const scenarios = [
	{
		name: 'captured-authoring',
		text: original.messages[2]!.content,
		allowed: ['studio_catalog', 'studio_author']
	},
	{
		name: 'german-discovery',
		text: 'Welche installierten Bausteine könnten einen wiederverwendbaren Skill für ein Materialtagebuch unterstützen? Bitte nur nachsehen, nichts anlegen oder ausführen.',
		allowed: ['studio_catalog']
	},
	{
		name: 'portuguese-discovery',
		text: 'Quais operações instaladas servem para montar uma rotina que guarda um resumo de cada ensaio de teatro? Só consulte o catálogo; não crie nem execute nada.',
		allowed: ['studio_catalog']
	},
	{
		name: 'french-task',
		text: 'Crée une tâche personnelle : ranger les emporte-pièces. Sans échéance. Pas besoin de Skill.',
		allowed: ['todo_create']
	}
]
try {
	for (let repetition = 0; repetition < 3; repetition++)
		for (const scenario of scenarios)
			for (const variant of repetition % 2 ? [...variants].reverse() : variants) {
				const messages = structuredClone(original.messages)
				messages[2]!.content = scenario.text
				if (variant === 'manifest-owned') {
					const obsolete = 'Call registry_list when you are unsure which actors exist. '
					assert(messages[0]!.content.includes(obsolete))
					messages[0]!.content = messages[0]!.content.replace(obsolete, '')
				}
				if (variant === 'inventory')
					messages[0]!.content +=
						'\n\nCallable tool names for this request (use these exact names with their declared argument schemas; catalog capability IDs are data, not callable tools):\n' +
						tools.map((tool) => tool.name).join(', ')
				const run: any = {
					scenario: scenario.name,
					repetition,
					variant,
					text: scenario.text,
					events: [],
					calls: [],
					passed: false
				}
				run.options = {
					...effectiveOptions,
					...(variant === 'reasoning' && { thinking: true }),
					...(variant === 'non-reasoning' && { thinking: false })
				}
				evidence.runs.push(run)
				const began = performance.now()
				try {
					for await (const event of stream(
						messages,
						tools,
						AbortSignal.timeout(180_000),
						undefined,
						run.options
					))
						run.events.push(event)
					const calls = new Map<number, { name: string; args: string }>()
					for (const event of run.events)
						if (event.kind === 'tool') {
							const call = calls.get(event.index) ?? { name: '', args: '' }
							call.name += event.name ?? ''
							call.args += event.args ?? ''
							calls.set(event.index, call)
						}
					run.calls = [...calls.values()]
					run.passed =
						run.calls.length > 0 &&
						run.calls.every((call: { name: string; args: string }) => {
							const args = JSON.parse(call.args)
							return (
								scenario.allowed.includes(call.name) &&
								tools.some((tool) => tool.name === call.name) &&
								args &&
								typeof args === 'object' &&
								!Array.isArray(args)
							)
						}) &&
						run.events.some(
							(event: any) => event.kind === 'finish' && event.reason === 'tool_calls'
						)
				} catch (error) {
					run.error = String(error)
				}
				run.durationMs = performance.now() - began
				await save()
			}
	evidence.completed = true
} finally {
	await save()
	console.log(
		JSON.stringify({
			evidence: `${directory}/evidence.json`,
			completed: evidence.completed,
			results: variants.map((variant) => ({
				variant,
				passed: evidence.runs.filter((run: any) => run.variant === variant && run.passed).length,
				total: evidence.runs.filter((run: any) => run.variant === variant).length
			}))
		})
	)
}
