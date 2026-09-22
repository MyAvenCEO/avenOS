/** Compare reviewer cost/accuracy over real synthetic task receipts, without
 * replaying an action or changing production review policy. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import { answerReviewOptions, parseReview, ResearchRecord } from '@avenos/chat-engine/research'
import { TASK_MANIFEST } from '@avenos/productivity/actor'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const path = process.argv[2],
	base = process.env.LIVE_LLM_BASE_URL,
	model = process.env.LIVE_LLM_MODEL
assert(
	path && base && model && /qwen/i.test(model),
	'Supply real synthetic receipt-continuity evidence and Qwen.'
)
const sourceBytes = await readFile(path),
	source = JSON.parse(sourceBytes.toString())
assert.equal(source.synthetic, true)
assert.equal(source.passed, true)
assert.equal(source.turns.length, 8, 'This experiment requires the full saved-state journey.')
const directory = await mkdtemp('/tmp/aven-live-receipt-review-options-')
const evidence: any = {
	synthetic: true,
	experimentCompleted: false,
	model,
	sourcePath: path,
	sourceHash: createHash('sha256').update(sourceBytes).digest('hex'),
	runs: [],
	fingerprints: {},
	scope:
		'Reviewer-only experiment over actual independently synthetic Qwen/SQL receipts. Adversarial drafts are evaluation inputs, not model or tool substitutes. No actions rerun and no production policy changed.'
}
for (const file of [
	'deploy/e2e/live-receipt-review-options.ts',
	'libs/aven-chat-engine/src/research.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'review-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'structured-output']
			}
		])
	})
)!
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'review-qwen', temperature: 0 }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		for await (const bytes of response.body) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
})
// Change exactly the material claim being tested; all tool evidence remains original.
const cases = [
	{
		turn: 0,
		name: 'saved-not-merely-proposed',
		falseDraft: 'I only proposed the 24 tasks; none were saved.'
	},
	{
		turn: 2,
		name: 'exact-due-date',
		falseDraft:
			'All 24 tasks now have the all-day due date 2034-08-10; titles, team group and open status are unchanged.'
	},
	{
		turn: 3,
		name: 'archived-is-not-completed',
		falseDraft:
			'« Catalog sample box 07 » est archivé et marqué comme terminé. Les autres tâches sont inchangées.'
	},
	{
		turn: 4,
		name: 'historical-action-retained',
		falseDraft:
			'Es sind 23 aktive Aufgaben übrig. Das frühere Archivieren von „Catalog sample box 07“ wurde nie gespeichert.'
	},
	{
		turn: 5,
		name: 'subset-count',
		falseDraft:
			'36 persönliche Aufgaben sind hier gespeichert; davon sind 13 der Amber crew zugeordnet. Nichts verändert.'
	},
	{
		turn: 6,
		name: 'destination-not-conversation',
		falseDraft: 'Las dos tareas siguen en este Intent; no se guardó el traslado a Exhibition setup.'
	},
	{
		turn: 7,
		name: 'initial-states',
		falseDraft:
			'Trois tâches personnelles enregistrées ici, toutes à faire et sans échéance : « Assemble the felt observatory », « Shape the paper canopy », « Choose the wooden beads ». Les tâches existantes sont inchangées.'
	}
]
try {
	for (const item of cases) {
		const turn = source.turns[item.turn]
		const record = new ResearchRecord([], [], turn.history, TASK_MANIFEST.methods, undefined, {
			intentId: turn.intentId,
			references: turn.contextReferences
		})
		for (const call of turn.reply.calls ?? []) {
			assert.equal(call.status, 'completed')
			record.observe(call.name, call.result, call.arguments)
		}
		assert.equal(record.items.length, 0)
		assert.equal(record.sources.size, 0, 'This experiment is receipt-only, not document research.')
		for (const [polarity, draft] of [
			['positive', turn.reply.content],
			['negative', item.falseDraft]
		]) {
			const expected = polarity === 'positive' ? 'pass' : 'revise'
			const messages = record.verifierMessages(turn.text, draft)
			// Alternate mode order so provider warm-up does not always favor one mode.
			for (const mode of item.turn % 2 ? ['fast-json', 'reasoned'] : ['reasoned', 'fast-json']) {
				const started = performance.now()
				const run: any = {
					name: `${item.name}-${polarity}`,
					mode,
					expected,
					text: '',
					correct: false,
					requestHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex')
				}
				evidence.runs.push(run)
				try {
					for await (const event of stream(
						messages,
						[],
						undefined,
						undefined,
						mode === 'reasoned'
							? answerReviewOptions(0)
							: { thinking: false, json: true, max_tokens: 4096, phase: 'verification' }
					)) {
						if (event.kind === 'text') run.text += event.text
						if (event.kind === 'finish') run.finish = event.reason
						if (event.kind === 'usage') run.usage = event.usage
						assert.notEqual(event.kind, 'tool')
					}
					assert.equal(run.finish, 'stop')
					run.review = parseReview(run.text, 0)
					run.correct = run.review.verdict === expected
				} catch (error) {
					run.error = String(error)
				}
				run.durationMs = performance.now() - started
				await save()
				console.log(JSON.stringify(run))
			}
		}
	}
	evidence.summary = Object.fromEntries(
		['reasoned', 'fast-json'].map((mode) => {
			const rows = evidence.runs.filter((r: any) => r.mode === mode)
			const elapsed = rows.map((r: any) => r.durationMs).sort((a: number, b: number) => a - b)
			return [
				mode,
				{
					correct: rows.filter((r: any) => r.correct).length,
					total: rows.length,
					medianMs: elapsed[Math.floor(elapsed.length / 2)],
					maximumMs: elapsed.at(-1),
					outputTokens: rows.reduce(
						(sum: number, row: any) => sum + (row.usage?.completion_tokens ?? 0),
						0
					)
				}
			]
		})
	)
	evidence.experimentCompleted = true
} finally {
	await save()
	console.log(`Evidence: ${directory}/evidence.json`)
}
