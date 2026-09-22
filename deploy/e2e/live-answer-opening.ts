/** Real-model calibration of answer openings. Independently invented topics only. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { ChatCore } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import { modelMetricsFromPayload } from '../../libs/aven-chat-engine/src/model-metrics'
import { ANSWER_OPENING_INSTRUCTIONS } from '../../libs/aven-chat-engine/src/request-scope'
import { turnPayload } from '../../libs/aven-chat-engine/src/turn-payload'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL,
	model = process.env.LIVE_LLM_MODEL
assert(
	base && model && /qwen/i.test(model),
	'Configure the actual Qwen endpoint; no model substitute.'
)
const compare = process.env.COMPARE_LEGACY_OPENING === 'true'
// Historical control for this experiment only, never a production fallback.
const legacy =
	'Your first sentence is always very short, five words at most, ending with a period. Everything else follows in the sentences after it. '
const directory = await mkdtemp('/tmp/aven-live-answer-opening-')
const evidence: any = {
	synthetic: true,
	model,
	passed: false,
	compare,
	startedAt: new Date().toISOString(),
	fingerprints: {},
	trials: [],
	scope:
		'Shared ChatCore and real gateway/Qwen; no audio device, SQL, native UI or loaded-latency qualification.'
}
for (const file of [
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/request-scope.ts',
	'deploy/e2e/live-answer-opening.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
console.log(directory)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'opening-qwen',
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
const scenarios = [
	{
		language: 'English',
		text: 'I would like to explore container gardening. I have not decided on a goal yet.'
	},
	{
		language: 'German',
		text: 'Ich möchte über ein Puppentheater nachdenken. Ein konkretes Vorhaben habe ich noch nicht.'
	},
	{
		language: 'Spanish',
		text: 'Quiero pensar en un mapa de árboles del barrio, pero aún no sé qué resultado busco.'
	},
	{
		language: 'French',
		text: 'Je voudrais réfléchir à un atelier de poterie, sans projet précis pour le moment.'
	},
	{
		language: 'Portuguese',
		text: 'Gostaria de explorar a encadernação artesanal, mas ainda não tenho um objetivo definido.'
	},
	{
		language: 'Italian',
		text: 'Vorrei ragionare su un piccolo orto scolastico, ma non ho ancora un obiettivo concreto.'
	},
	{
		language: 'French-format',
		text: 'Réponds exactement avec le mot « prêt », sans ponctuation.',
		exact: 'prêt'
	}
]
try {
	for (let repetition = 0; repetition < 2; repetition++)
		for (const scenario of scenarios) {
			// Alternate ordering rather than attributing cache or provider load to wording.
			const variants = compare
				? repetition
					? ['natural', 'legacy']
					: ['legacy', 'natural']
				: ['production']
			for (const variant of variants) {
				const stream = createGatewayModelStream({
					request: (input) => {
						const original = input.messages[0]!
						assert.equal(original.role, 'system')
						const active = original.content.includes(legacy) ? legacy : ANSWER_OPENING_INSTRUCTIONS
						assert(
							original.content.includes(active),
							'The production opening must be recognized, not silently patched elsewhere.'
						)
						const wanted =
							variant === 'legacy'
								? legacy
								: variant === 'natural'
									? ANSWER_OPENING_INSTRUCTIONS
									: active
						return chatGatewayRequest({
							...input,
							model: 'opening-qwen',
							messages: [
								{ ...original, content: original.content.replace(active, wanted) },
								...input.messages.slice(1)
							]
						})
					},
					open: async function* (request, signal) {
						const response = await gateway.openAiChatCompletion(request, signal)
						assert(response.ok && response.body)
						const decoder = new TextDecoder()
						for await (const chunk of response.body!) yield decoder.decode(chunk, { stream: true })
						yield decoder.decode()
					}
				})
				const chat = new ChatCore(
					{},
					{
						specs: [],
						run: () => {
							throw Error('No action was authorized.')
						}
					},
					stream
				)
				const intentId = randomUUID()
				chat.use(intentId)
				await chat.send(scenario.text, undefined, {
					context: '',
					calls: [],
					user: {
						id: randomUUID(),
						role: 'user',
						content: scenario.text,
						inputAdmission: {
							intentId,
							destination: 'existing',
							confirmed: true,
							responseMode: scenario.exact ? 'work' : 'clarify'
						}
					}
				})
				const reply = chat.turns.at(-1)!,
					answer = reply.content.trim()
				const trial = {
					repetition,
					language: scenario.language,
					variant,
					request: scenario.text,
					answer,
					failure: chat.failure,
					calls: chat.toolCalls,
					metrics: modelMetricsFromPayload(turnPayload(reply)),
					passed:
						!chat.failure &&
						!chat.toolCalls.length &&
						(scenario.exact
							? answer === scenario.exact
							: answer.endsWith('?') && answer.length < 500)
				}
				evidence.trials.push(trial)
				await save()
			}
		}
	evidence.passed = evidence.trials
		.filter((trial: any) => trial.variant !== 'legacy')
		.every((trial: any) => trial.passed)
	assert(
		evidence.passed,
		'Inspect all failed openings and semantics before adopting the candidate.'
	)
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(JSON.stringify({ directory, passed: evidence.passed }))
}
