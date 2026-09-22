/** Synthetic conversational feedback through the production Qwen assessor and real SQL store. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { automaticFeedbackCommand, feedbackCommand } from '@avenos/chat-engine/response-feedback'
import pg from 'pg'
import type { InputFeedback } from '../../libs/aven-llm-client/src/input-decision'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { IntentStore } from '../../services/intent-service/src/store'
import { interactionFeedbackCases } from './feedback-scenarios'

const base = process.env.LIVE_LLM_BASE_URL,
	databaseUrl = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
assert(base && databaseUrl, 'Supply the trusted Qwen URL and a disposable PostgreSQL test cluster.')
const models = await fetch(`${base}/models`).then((r) => r.json())
const upstream = models.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(upstream)
let lastDecisionArguments: unknown
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'input-qwen',
				label: 'Qwen feedback proof',
				baseUrl: base,
				upstreamModel: upstream,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'structured-output', 'streaming', 'tool-calling']
			}
		])
	}),
	async (url, options) => {
		const response = await fetch(url, options)
		// Retain actual structured output in this synthetic proof, including invalid
		// quotations that the production parser must not silently turn into neutral.
		void response
			.clone()
			.json()
			.then((raw) => {
				lastDecisionArguments = raw.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
			})
			.catch(() => {})
		return response
	}
)!
const out = await mkdtemp('/tmp/aven-input-feedback-')
const evidence: any = {
	synthetic: true,
	scope: 'real Qwen feedback assessment + production SQL persistence; native UI proved separately',
	model: upstream,
	startedAt: new Date().toISOString(),
	fingerprints: {},
	cases: [],
	passed: false
}
for (const path of [
	'deploy/e2e/live-input-feedback.ts',
	'deploy/e2e/feedback-scenarios.ts',
	'libs/aven-llm-client/src/input-decision.ts',
	'libs/aven-chat-engine/src/response-feedback.ts',
	'services/intent-service/src/store.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(new URL('../../' + path, import.meta.url)))
		.digest('hex')
const admin = new pg.Pool({ connectionString: databaseUrl })
const database = `feedback_${randomUUID().replaceAll('-', '')}`
let pool: pg.Pool | undefined
try {
	await admin.query(`CREATE DATABASE ${database}`)
	const url = new URL(databaseUrl)
	url.pathname = `/${database}`
	pool = new pg.Pool({
		connectionString: url.toString(),
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
		owner = randomUUID()
	const intent = await store.create(owner, {
		id: randomUUID(),
		title: 'Model railway workshop',
		intentType: 'test',
		sourceLabel: 'Chat',
		deadline: null
	})
	const first = await gateway.complete({
		modelId: 'input-qwen',
		requiredCapabilities: ['text-generation'],
		instructions: 'Answer the fictional question briefly. Do not claim to have taken actions.',
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: 'What two labels help organize spare parts for a miniature railway?'
					}
				]
			}
		],
		output: { format: 'text' },
		maxOutputTokens: 2048,
		temperature: 0
	})
	assert.equal(first.output.format, 'text')
	const answer = (first.output as { format: 'text'; text: string }).text
	assert(answer?.length)
	const reply = await store.append(owner, intent.id, {
		id: randomUUID(),
		contributorKind: 'agent',
		kind: 'message',
		text: answer,
		payload: {}
	})
	const context = {
		selectedId: intent.id,
		intents: [{ id: intent.id, title: intent.title }],
		recent: [
			{
				role: 'user',
				content: 'What two labels help organize spare parts for a miniature railway?'
			},
			{ role: 'assistant', content: answer.slice(0, 1200), responseId: reply.id }
		]
	}
	evidence.context = context
	const cases: [string, 'up' | 'down' | null][] = [
		['That explanation is exactly what I needed. Very useful!', 'up'],
		['Damit kann ich nichts anfangen. Deine Antwort geht völlig an meiner Frage vorbei.', 'down'],
		['Nice, your suggestion makes the sorting much clearer.', 'up'],
		['Nee, so stimmt deine Antwort nicht. Du verwechselst da zwei Dinge.', 'down'],
		['Die Ersatzteile sind leider furchtbar teuer.', null],
		['Great news: the new locomotive arrived!', null],
		['Yes, go ahead.', null],
		['Danke.', null],
		['Warum schlägst du genau diese Felder vor?', null],
		['A review says "your answer is rubbish". Translate that sentence.', null],
		['Your explanation is not bad at all; that really helped me understand.', 'up'],
		['Oh brilliant, another answer that ignores what I asked. This is useless.', 'down'],
		[
			'The structure is good, but the information is wrong. Overall this answer is not helpful.',
			'down'
		],
		['Useful structure, wrong details; I have mixed feelings and cannot rate it overall.', null],
		['Your answer was helpful. Open a new Intent named Balcony plants.', 'up'],
		['In a fictional dialogue someone says: "Excellent answer!" What tone is that?', null],
		['No, I meant replacement wheels rather than track. Please adjust the explanation.', null],
		['Das ist eine super verständliche Antwort, genau so!', 'up'],
		...interactionFeedbackCases
	]
	const repetitions = Number(process.env.FEEDBACK_REPETITIONS ?? 2)
	assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 5)
	for (let repetition = 0; repetition < repetitions; repetition++)
		for (const [text, vote] of cases) {
			const start = performance.now()
			try {
				const result = await gateway.inputDecision(
					{
						kind: 'feedback',
						modelId: 'input-qwen',
						locale: 'en-GB',
						text,
						recent: context.recent
					},
					owner
				)
				const feedback = result.decision as InputFeedback | null
				evidence.cases.push({
					repetition,
					text,
					expected: vote,
					rawDecision: lastDecisionArguments,
					feedback,
					durationMs: performance.now() - start,
					passed: (feedback?.vote ?? null) === vote && (!vote || feedback?.responseId === reply.id)
				})
			} catch (error) {
				evidence.cases.push({
					repetition,
					text,
					expected: vote,
					error: String(error),
					passed: false
				})
			}
			await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
		}
	// Persist an actual positive assessment, then exercise manual priority and provenance.
	const positive = evidence.cases.find((c: any) => c.passed && c.expected === 'up')
	assert(positive)
	const reaction = { ...positive.feedback, intentId: intent.id, commandId: randomUUID() }
	const check = {
		commandId: reaction.commandId,
		intentId: intent.id,
		locale: 'en-GB',
		recent: context.recent
	}
	const inputId = randomUUID()
	const automatic = automaticFeedbackCommand(
		reaction,
		inputId,
		null,
		undefined,
		positive.feedback.quote
	)!
	await assert.rejects(store.append(owner, intent.id, automatic), /source not found/)
	await store.append(owner, intent.id, {
		id: inputId,
		contributorKind: 'human',
		kind: 'message',
		text: positive.text,
		payload: { feedbackCheck: check }
	})
	await store.append(owner, intent.id, automatic)
	const reload = (await store.message(owner, reply.id)).feedback
	assert.equal(reload.inferredFrom, inputId)
	assert.equal(reload.vote, 'up')
	assert.equal((await store.append(owner, intent.id, automatic)).id, automatic.id)
	// A click composed before the inference committed must still win.
	await store.append(
		owner,
		intent.id,
		feedbackCommand(reply.id, null, 'down', 'Please give a concrete parts example.')
	)
	const manual = (await store.message(owner, reply.id)).feedback
	assert.equal(manual.vote, 'down')
	assert.equal(manual.inferredFrom, undefined)
	await store.append(owner, intent.id, feedbackCommand(reply.id, manual, null, ''))
	const clear = (await store.message(owner, reply.id)).feedback
	assert.equal(automaticFeedbackCommand(reaction, inputId, clear), null)
	const another = { ...reaction, commandId: randomUUID() },
		sourceId = randomUUID()
	await store.append(owner, intent.id, {
		id: sourceId,
		contributorKind: 'human',
		kind: 'message',
		text: positive.text,
		payload: { feedbackCheck: { ...check, commandId: another.commandId } }
	})
	await assert.rejects(
		store.append(
			owner,
			intent.id,
			automaticFeedbackCommand(another, sourceId, null, undefined, positive.feedback.quote)!
		),
		/Manual feedback/
	)
	assert.equal((await store.message(owner, reply.id)).feedback.vote, null)
	assert.equal((await store.message(owner, reply.id)).content, answer)
	evidence.persistence = {
		saved: true,
		reloaded: true,
		provenance: true,
		missingSourceRejected: true,
		idempotent: true,
		manualWinsRace: true,
		editableReason: true,
		manualClearProtected: true
	}
	evidence.passed = evidence.cases.every((c: any) => c.passed)
	evidence.finishedAt = new Date().toISOString()
	console.log(
		JSON.stringify({
			output: out,
			passed: evidence.passed,
			cases: evidence.cases.length,
			failures: evidence.cases.filter((c: any) => !c.passed)
		})
	)
	assert(evidence.passed, 'Inspect every failure; do not discard failed attempts.')
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	await pool?.end()
	await admin.query(`DROP DATABASE IF EXISTS ${database}`)
	await admin.end()
}
