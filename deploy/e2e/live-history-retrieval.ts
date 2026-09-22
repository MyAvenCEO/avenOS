/** Exact old-message retrieval with real SQL, production Actors/engine and Qwen. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import pg from 'pg'
import { createRetrievalActor } from '../../libs/aven-actors/src/retrieval'
import { ChatCore, type Turn } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import type { SourceContext } from '../../libs/aven-chat-engine/src/source-context'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { IntentStore } from '../../services/intent-service/src/store'

const url = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL
assert(url && base, 'Use trusted Qwen and a disposable PostgreSQL test cluster.')
const model = (await fetch(base + '/models').then((r) => r.json())).data.find((m: any) =>
	/qwen/i.test(m.id)
)?.id
assert(model)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'history-qwen',
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
	request: (input) => chatGatewayRequest({ ...input, model: 'history-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok)
		const decoder = new TextDecoder()
		for await (const bytes of response.body!) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
})
const directory = await mkdtemp('/tmp/aven-live-history-retrieval-')
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	startedAt: new Date().toISOString(),
	fingerprints: {},
	scope:
		'Production SQL history, retrieval Actor, writer/reviewer and real Qwen; not a native UI or acoustic speech test. Exact-quote and source-read assertions require additional human review of uncertainty and relevance.',
	runs: []
}
for (const path of [
	'deploy/e2e/live-history-retrieval.ts',
	'libs/aven-actors/src/retrieval.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/history-selection.ts',
	'libs/aven-chat-engine/src/input-admission.ts',
	'libs/aven-intents/src/retrieval.ts',
	'services/intent-service/src/store.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(new URL('../../' + path, import.meta.url)))
		.digest('hex')
console.log(directory)
const admin = new pg.Pool({ connectionString: url }),
	database = 'history_' + crypto.randomUUID().replaceAll('-', '')
let pool: pg.Pool | undefined
try {
	await admin.query('CREATE DATABASE ' + database)
	const dbUrl = new URL(url)
	dbUrl.pathname = '/' + database
	pool = new pg.Pool({
		connectionString: dbUrl.toString(),
		options: '-c search_path=aven_intents,public'
	})
	await pool.query('CREATE SCHEMA aven_intents')
	await pool.query(
		await readFile(
			new URL(
				'../../services/platform-provisioner/components/intents/0001_intents.sql',
				import.meta.url
			),
			'utf8'
		)
	)
	const store = new IntentStore(pool),
		owner = crypto.randomUUID(),
		intentId = crypto.randomUUID()
	await store.create(owner, {
		id: intentId,
		title: 'Fictional observatory workshop',
		intentType: 'conversation',
		sourceLabel: 'Chat',
		deadline: null
	})
	// Independently invented stored history. Activity and assistant contributions
	// deliberately separate contribution sequence from the ordinal of user messages.
	const humans: { id: string; text: string }[] = [],
		assistants: { id: string; text: string }[] = []
	for (let n = 1; n <= 33; n++) {
		const text =
			n === 1
				? 'For our imaginary observatory, the welcome desk should use a violet triangle on the sign.'
				: n === 7
					? 'The imaginary telescope shelf is called Copper Heron.'
					: n === 17
						? 'Fictional wind-up exhibit planning notes.\n' +
							'Invented wooden gears, paper feathers and painted springs remain in the workshop. '.repeat(
								60
							) +
							'\nThe final name for our wind-up exhibit is Cobalt Lantern.'
						: `Workshop note ${n}: use tray ${n} for the fictional spare part.`
		const human = { id: crypto.randomUUID(), text }
		humans.push(human)
		await store.append(owner, intentId, {
			...human,
			contributorKind: 'human',
			kind: 'message',
			payload: {}
		})
		const assistant = {
			id: crypto.randomUUID(),
			text: `Fictional response ${n}: the workshop note is part of this discussion.`
		}
		assistants.push(assistant)
		await store.append(owner, intentId, {
			...assistant,
			contributorKind: 'agent',
			kind: 'message',
			payload: {}
		})
		if (n % 5 === 0)
			await store.append(owner, intentId, {
				id: crypto.randomUUID(),
				contributorKind: 'agent',
				kind: 'test-activity',
				text: 'Synthetic activity boundary.',
				payload: {}
			})
	}
	// A later message elsewhere must not become the answer to "last thing here".
	const otherIntent = crypto.randomUUID()
	await store.create(owner, {
		id: otherIntent,
		title: 'Fictional puppet wardrobe',
		intentType: 'conversation',
		sourceLabel: 'Chat',
		deadline: null
	})
	await store.append(owner, otherIntent, {
		id: crypto.randomUUID(),
		contributorKind: 'human',
		kind: 'message',
		text: 'For the imaginary puppet show, use silver buttons on the cloud costume.',
		payload: {}
	})
	const carried = { id: crypto.randomUUID(), text: 'The marionette box is called Saffron Kite.' }
	await store.append(owner, otherIntent, {
		...carried,
		contributorKind: 'human',
		kind: 'message',
		payload: {}
	})
	const excerpt = (shortened = false): SourceContext => ({
		intentId: otherIntent,
		capturedAt: new Date().toISOString(),
		messages: [
			{
				id: carried.id,
				role: 'user',
				content: shortened ? 'The marionette box is called' : carried.text,
				shortened
			}
		]
	})
	const scenarios: Array<{
		name: string
		prompt: string
		source: { id: string; text: string }
		recent?: boolean
		sourceContext?: SourceContext
		expected?: string
		evidenceQuote?: string
		noRetrieval?: boolean
		confirmed?: boolean
	}> = [
		{
			name: 'first-user',
			prompt: 'What exactly was my very first message in this Intent? Quote it.',
			source: humans[0]
		},
		{
			name: 'seventh-user',
			prompt:
				'Zeige mir meine siebte Nachricht in diesem Intent in zeitlicher Reihenfolge. Nur meine Nachrichten zählen, nicht deine Antworten. Bitte wörtlich zitieren.',
			source: humans[6]
		},
		{
			name: 'first-assistant',
			prompt: 'Quelle était ta toute première réponse dans cet Intent ? Cite le texte exact.',
			source: assistants[0]
		},
		{
			name: 'latest-user',
			prompt: 'last thing i wrote here before this question pls, exact words',
			source: humans.at(-1)!
		},
		{
			name: 'latest-user-german',
			prompt: 'Was hab ich direkt davor hier geschrieben? Bitte den Originalwortlaut.',
			source: humans.at(-1)!
		},
		{
			name: 'latest-user-spanish',
			prompt: 'Copia mi último mensaje guardado en esta conversación, anterior a esta pregunta.',
			source: humans.at(-1)!
		},
		{
			name: 'recent-user-context',
			prompt: 'Comment avais-je appelé cette étagère ? Juste son nom, s’il te plaît.',
			source: humans[6],
			recent: true,
			expected: 'Copper Heron',
			noRetrieval: true
		},
		{
			name: 'carried-user-context',
			prompt:
				'Wie hieß nochmal die Marionettenkiste, die ich dort benannt habe? Nur den Namen bitte.',
			source: carried,
			sourceContext: excerpt(),
			expected: 'Saffron Kite',
			noRetrieval: true
		},
		{
			name: 'accepted-destination-context',
			prompt:
				'Go back to Fictional observatory workshop and remind me what I called the telescope shelf. Just its name.',
			source: humans[6],
			recent: true,
			confirmed: true,
			expected: 'Copper Heron',
			noRetrieval: true
		},
		{
			name: 'long-recent-message-tail',
			prompt: 'What final name did I give our wind-up exhibit? Just its name please.',
			source: humans[16],
			recent: true,
			expected: 'Cobalt Lantern',
			evidenceQuote: 'The final name for our wind-up exhibit is Cobalt Lantern.'
		},
		{
			name: 'shortened-excerpt-is-insufficient',
			prompt: 'Dime cómo llamé a la caja de marionetas; la frase en el contexto parece cortada.',
			source: carried,
			sourceContext: excerpt(true),
			expected: 'Saffron Kite'
		}
	]
	const record = (value: unknown) => ({
		record: JSON.stringify(value),
		wire: JSON.stringify(value)
	})
	const selected = process.env.LIVE_HISTORY_CASES?.split(',')
	assert(
		!selected || selected.every((name) => scenarios.some((scenario) => scenario.name === name)),
		'Unknown history scenario'
	)
	for (const scenario of scenarios.filter(
		(scenario) => !selected || selected.includes(scenario.name)
	)) {
		const actor = createRetrievalActor({
			intent_list: async (args) => record(await store.page(owner, args)),
			intent_detail: async (args) => record(await store.preview(owner, String(args.intent))),
			intent_messages: async (args) => record(await store.messages(owner, args)),
			message_detail: async (args) =>
				record(await store.message(owner, String(args.id), Number(args.offset ?? 0)))
		})
		try {
			const chat = new ChatCore(
				{},
				{
					specs: actor.manifest.methods,
					run: (name, args) => actor.deliver(name, JSON.parse(args))
				},
				stream
			)
			chat.use(intentId)
			if (scenario.recent)
				chat.hydrate(intentId, [
					{ id: scenario.source.id, role: 'user', content: scenario.source.text, persisted: true }
				])
			chat.context = () =>
				`Accepted conversation Intent: ${intentId}, title Fictional observatory workshop. Other stored history may be outside this recent context. The current question has not been saved yet.`
			const began = performance.now()
			let timedOut = false
			evidence.activeScenario = scenario.name
			await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
			const deadline = setTimeout(() => {
				timedOut = true
				chat.stop()
			}, 240_000)
			try {
				const user: Turn = {
					id: crypto.randomUUID(),
					role: 'user',
					content: scenario.prompt,
					inputAdmission: {
						intentId,
						destination: 'existing',
						confirmed: scenario.confirmed ?? false,
						...(scenario.sourceContext && { sourceContext: scenario.sourceContext })
					}
				}
				await chat.send(scenario.prompt, undefined, { user, context: chat.context(), calls: [] })
			} finally {
				clearTimeout(deadline)
			}
			const answer = chat.turns.filter((turn) => turn.role === 'assistant').at(-1)?.content ?? ''
			const readExpected = chat.toolCalls.some((call) => {
				if (
					!['workspace_read', 'workspace_search'].includes(call.name) ||
					call.status !== 'completed'
				)
					return false
				const result = JSON.parse(call.result ?? '{}')
				const quote = scenario.evidenceQuote ?? scenario.source.text
				return (
					(result.sourceId === scenario.source.id && result.content?.includes(quote)) ||
					result.messages?.some(
						(message: any) =>
							message.sourceId === scenario.source.id &&
							Number.isSafeInteger(message.offset) &&
							message.content.includes(quote)
					) ||
					result.conversation?.some(
						(message: any) =>
							message.sourceId === scenario.source.id &&
							message.complete &&
							message.content.includes(quote)
					)
				)
			})
			const result = {
				name: scenario.name,
				prompt: scenario.prompt,
				expected: scenario.source,
				answer,
				failure: chat.failure,
				timedOut,
				durationMs: performance.now() - began,
				calls: chat.toolCalls,
				diagnostics: chat.diagnostics,
				passed:
					!timedOut &&
					!chat.failure &&
					chat.toolCalls.every((call) => call.status === 'completed') &&
					answer.includes(scenario.expected ?? scenario.source.text) &&
					(scenario.noRetrieval ? chat.toolCalls.length === 0 : readExpected)
			}
			evidence.runs.push(result)
			await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
			console.log(
				JSON.stringify({
					name: scenario.name,
					passed: result.passed,
					calls: result.calls.length,
					durationMs: result.durationMs
				})
			)
		} finally {
			actor.dispose()
		}
	}
	delete evidence.activeScenario
	evidence.passed = evidence.runs.every((run: any) => run.passed)
	assert(evidence.passed, 'Inspect the saved answers and traces; failed journeys remain evidence.')
} finally {
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
	await pool?.end()
	await admin.query('DROP DATABASE IF EXISTS ' + database)
	await admin.end()
}
