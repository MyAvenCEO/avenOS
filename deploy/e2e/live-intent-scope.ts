/** Production Chat and reviewer, real Qwen, real Intent writes in the fictional test account. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { parseReview, ResearchRecord } from '@avenos/chat-engine/research'
import {
	type ChatMessage,
	openAiGatewayRequest,
	streamEvents,
	type ToolSpec
} from '../../app/src/lib/chat/redpill'

const previous = await Bun.file(
	process.argv[2] ?? '/tmp/aven-live-studio-workday/2026-09-17T16-43-06.592Z/evidence.json'
).json()
assert.equal(previous.synthetic, true)
assert.match(previous.environmentId, /^[0-9a-f-]{36}$/)
const session = await Bun.file('/tmp/aven-live-studio-workday/private-session.json').json()
assert.equal(session.identity, 'http://localhost:13100')
assert.match(session.accountId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/)
const auth = await fetch(session.identity + '/api/auth/token', {
	headers: {
		cookie: session.browser.cookies
			.filter((c: any) => c.domain === 'localhost')
			.map((c: any) => `${c.name}=${c.value}`)
			.join('; ')
	}
})
assert(auth.ok)
const token = ((await auth.json()) as any).token
const environments = await fetch('http://localhost:13000/api/environments', {
	headers: { authorization: `Bearer ${token}` }
})
assert(environments.ok)
const selectedEnvironment = ((await environments.json()) as any).environments.find(
	(environment: any) => environment.id === previous.environmentId
)
assert(selectedEnvironment, 'The test account must own the selected environment')
assert.match(
	selectedEnvironment.purchasedName,
	new RegExp(`^workday-${session.accountId.slice(0, 8)}-[a-z0-9]+$`),
	'Only an environment created by the fictional workday harness is allowed'
)
const catalogResponse = await fetch('http://localhost:13000/api/llm/models', {
	headers: { authorization: `Bearer ${token}` }
})
assert(catalogResponse.ok)
const catalog = (await catalogResponse.json()) as any
const selectedModel = catalog.models.find((m: any) => /qwen/i.test(m.id + m.label))
assert(selectedModel, 'The configured live Qwen model is required')
const directory = '/tmp/aven-live-intent-scope/' + new Date().toISOString().replaceAll(':', '-')
await mkdir(directory, { recursive: true })
const evidence: any = {
	synthetic: true,
	environmentId: previous.environmentId,
	turns: [],
	startedAt: new Date().toISOString()
}
const request = async (path: string, body?: unknown) => {
	const response = await fetch(
		`http://localhost:13000/api/environments/${previous.environmentId}/intents${path}`,
		{
			method: body ? 'POST' : 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			...(body ? { body: JSON.stringify(body) } : {})
		}
	)
	assert(response.ok, `Intent HTTP ${response.status}`)
	return response.json() as Promise<any>
}
async function* model(
	messages: ChatMessage[],
	tools: ToolSpec[],
	_model?: string,
	signal?: AbortSignal,
	options: any = {}
) {
	const response = await fetch('http://localhost:13000/api/llm/v1/chat/completions', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify(
			openAiGatewayRequest({
				messages,
				tools,
				...options,
				model: selectedModel.id
			})
		),
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(180000)])
			: AbortSignal.timeout(180000)
	})
	assert(response.ok, `Qwen HTTP ${response.status}`)
	async function* chunks() {
		const decoder = new TextDecoder()
		for await (const bytes of response.body as any) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
	yield* streamEvents(chunks())
}
;(globalThis as any).$state = (v: unknown) => v
const { Chat } = await import('../../app/src/lib/chat/chat.svelte')
try {
	for (const scenario of [
		{
			prompt: 'Starte bitte einen Intent für Lagerbestände. Das Thema möchte ich mir ansehen.',
			clarify: true
		},
		{
			prompt: 'Öffne ein neues Thema für Personalplanung. Damit möchte ich mich beschäftigen.',
			clarify: true
		},
		{
			prompt:
				'Öffne einen neuen Intent für mein Budget. In diesem fiktiven Beispiel kosten die zwei Posten 120 und 80 EUR. Wie hoch ist die Summe? Nur diese Angaben verwenden.',
			clarify: false
		}
	]) {
		const { prompt, clarify } = scenario
		let intentId: string | undefined
		const calls: string[] = []
		const chat = new Chat(
			{},
			{
				specs: [
					{
						name: 'intent_create',
						description:
							'Creates a new Intent and switches to it. Use when the user starts something new. If only a broad topic is given, create it and ask one short question about the desired outcome before searching or acting.',
						parameters: {
							type: 'object',
							properties: {
								title: { type: 'string' },
								type: { type: 'string' },
								source: { type: 'string' }
							},
							required: ['title']
						}
					},
					{
						name: 'workspace_search',
						description: 'Search saved documents, messages and Intents.',
						parameters: {
							type: 'object',
							properties: {
								kind: {
									type: 'string',
									enum: ['document', 'message', 'intent']
								},
								query: { type: 'string' }
							},
							required: ['kind', 'query']
						}
					}
				],
				run: async (name, args) => {
					calls.push(name)
					assert.equal(name, 'intent_create', 'An underspecified topic must not start research')
					assert.equal(intentId, undefined, 'Do not create the same Intent twice')
					const p = JSON.parse(args)
					intentId = randomUUID()
					await request('', {
						id: intentId,
						title: p.title,
						intentType: p.type ?? 'research',
						sourceLabel: 'Fictional scope regression'
					})
					return {
						record: JSON.stringify({
							ok: true,
							created: intentId,
							persistent: true
						}),
						wire: `Created ${p.title} and switched to it.`
					}
				}
			},
			model
		)
		chat.context = () =>
			'CONVERSATION INTENT: none. Recent unrelated invoices exist, but their contents have not been read for this task.'
		await chat.send(prompt)
		evidence.turns.push({
			prompt,
			intentId,
			calls,
			turns: chat.turns,
			failure: chat.failure,
			diagnostics: chat.diagnostics
		})
		assert.equal(chat.failure, null)
		assert.deepEqual(calls, ['intent_create'])
		const answer = chat.turns.filter((t) => t.role === 'assistant').at(-1)?.content ?? ''
		if (clarify) assert.match(answer, /\?/)
		else {
			assert.match(answer, /200/)
			assert.doesNotMatch(answer, /\?/)
		}
		assert(answer.length < 600, 'Opening a topic should stay concise')
		for (const [kind, text] of [
			['human', prompt],
			['agent', answer]
		])
			await request(`/${intentId}`, {
				id: randomUUID(),
				contributorKind: kind,
				kind: 'message',
				text,
				payload: {}
			})
		const saved = await request('/' + intentId)
		assert(saved.contributions.some((c: any) => c.text === answer))
		console.log('PASS topic opens with clarification:', answer)
	}
	// Previously, unrequested reads/checklist items became additional "requirements".
	const record = new ResearchRecord()
	record.observe(
		'intent_create',
		JSON.stringify({
			ok: true,
			created: evidence.turns[0].intentId,
			persistent: true
		})
	)
	record.observe(
		'workspace_read',
		JSON.stringify({
			ok: true,
			recordType: 'document',
			sourceId: 'fictional-invoice',
			title: 'Fictional invoice',
			content: 'Fictional supplier invoice. Total 120 EUR. Payment status unknown.',
			offset: 0,
			complete: true
		})
	)
	assert.equal(
		record.run('research_record', {
			items: [
				{
					requirement: 'Which invoices exist and are paid?',
					finding: 'One fictional invoice exists; payment unresolved.',
					status: 'supported',
					sources: [
						{
							sourceId: 'fictional-invoice',
							quote: 'Fictional supplier invoice. Total 120 EUR. Payment status unknown.'
						}
					]
				}
			]
		}).ok,
		true
	)
	const answer = 'Ist geöffnet. Was möchtest du zu den Rechnungen herausfinden?'
	let reviewText = ''
	for await (const event of model(
		record.verifierMessages(evidence.turns[0].prompt, answer),
		[],
		undefined,
		undefined,
		{ thinking: true, max_tokens: 12288 }
	))
		if (event.kind === 'text') reviewText += event.text
	const review = parseReview(reviewText, 1)
	evidence.scopeReview = review
	assert.equal(review.verdict, 'pass', JSON.stringify(review))
	evidence.passed = true
	console.log('PASS reviewer accepts clarification despite unsolicited evidence')
} finally {
	evidence.finishedAt = new Date().toISOString()
	await Bun.write(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
	console.log('Evidence:', directory + '/evidence.json')
}
