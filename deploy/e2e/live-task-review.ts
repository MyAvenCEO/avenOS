/** Audit-role qualification on actual synthetic Qwen/SQL task receipts, never customer history. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConversationMessage } from '@avenos/chat-engine/conversation-context'
import { answerReviewOptions, parseReview, ResearchRecord } from '@avenos/chat-engine/research'
import { taskManifest } from '@avenos/productivity/actor'

const endpoint = process.env.LIVE_LLM_BASE_URL
assert(endpoint, 'A real Qwen endpoint is required.')
const source = JSON.parse(await readFile(process.argv[2]!, 'utf8'))
assert(
	source.synthetic === true &&
		source.passed === true &&
		source.cases.length === 5 &&
		source.fingerprints['deploy/e2e/live-durable-tasks.ts'],
	'Use only a completed independently invented durable-task journey.'
)
const available = await fetch(`${endpoint.replace(/\/$/, '')}/models`, {
	signal: AbortSignal.timeout(10_000)
}).then((r) => {
	assert(r.ok)
	return r.json()
})
const model =
	process.env.LIVE_LLM_MODEL ?? available.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(model && /qwen/i.test(model))
const path = await mkdtemp(join(tmpdir(), 'aven-live-task-review-'))
const proof: any = {
	synthetic: true,
	model,
	source: process.argv[2],
	sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
	startedAt: new Date().toISOString(),
	passed: false,
	reviews: []
}
const history: ConversationMessage[] = []
const cases: Array<{
	name: string
	record: ResearchRecord
	question: string
	answer: string
	expected: 'pass' | 'revise'
}> = []
// Independently specified concise receipts. A previously accepted generated reply
// is evidence to inspect, not a gold answer: it can still contain surplus claims.
const correct = [
	'Saved both requested tasks in the team group, tagged workshop, with no due dates.',
	'Die Aufgabe für die Lötgeräte ist jetzt erledigt.',
	'Moved the magnifier task to your personal list, due 2031-04-12 as a whole-day date.',
	'',
	'Die Aufgabe wurde nur in einer temporären Kopie angelegt. In der echten Liste wurde nichts gespeichert.'
]
for (const [i, item] of source.cases.entries()) {
	const specs = taskManifest(item.trial ? 'trial' : 'production').methods
	const record = new ResearchRecord([], [], i === 3 || i === 4 ? [] : history, specs, {
		now: () => new Date(source.startedAt),
		timezone: 'Europe/London'
	})
	for (const call of item.reply.calls ?? [])
		if (call.result) record.observe(call.name, call.result, call.arguments)
	if (i !== 3)
		cases.push({
			name: `confirmed-receipt-${i}`,
			record,
			question: item.text,
			answer: correct[i]!,
			expected: 'pass'
		})
	if (i === 0)
		cases.push({
			name: 'denies-committed-create',
			record,
			question: item.text,
			answer: 'Nothing was saved. Both tasks only exist in a temporary trial list.',
			expected: 'revise'
		})
	if (i === 1)
		cases.push({
			name: 'archive-is-not-completion',
			record,
			question: item.text,
			answer: 'Ich habe die Aufgabe archiviert und aus der Liste entfernt.',
			expected: 'revise'
		})
	if (i === 2)
		cases.push({
			name: 'wrong-delivery-language',
			record,
			question: item.text,
			answer:
				'Die Aufgabe ist jetzt in deiner persönlichen Liste, fällig am 12. April 2031 als ganzer Tag.',
			expected: 'revise'
		})
	if (i === 4)
		cases.push({
			name: 'trial-is-not-production',
			record,
			question: item.text,
			answer: 'Die neue Aufgabe ist dauerhaft in deiner echten Liste gespeichert.',
			expected: 'revise'
		})
	history.push(
		{ role: 'user', content: item.text },
		{ role: 'assistant', content: item.reply.content }
	)
}
try {
	const variants = process.env.REVIEW_VARIANT ? [process.env.REVIEW_VARIANT] : ['production']
	assert(variants.every((variant) => ['production', 'candidate-fast'].includes(variant)))
	for (const scenario of cases)
		for (const variant of variants) {
			const messages = scenario.record.verifierMessages(scenario.question, scenario.answer)
			const options = {
				...answerReviewOptions(0),
				...(variant === 'candidate-fast' && { thinking: false, json: true })
			}
			const started = performance.now()
			const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				signal: AbortSignal.timeout(180_000),
				body: JSON.stringify({
					model,
					messages,
					max_tokens: options.max_tokens,
					temperature: 0.2,
					chat_template_kwargs: { enable_thinking: options.thinking },
					...(options.json && { response_format: { type: 'json_object' } })
				})
			})
			assert(response.ok, `Qwen HTTP ${response.status}`)
			const completion = await response.json(),
				choice = completion.choices?.[0]
			const result: any = {
				name: scenario.name,
				variant,
				expected: scenario.expected,
				durationMs: performance.now() - started,
				finish: choice?.finish_reason,
				response: choice?.message?.content,
				usage: completion.usage,
				promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex')
			}
			try {
				assert.equal(result.finish, 'stop')
				result.review = parseReview(result.response, 0)
				result.correct = result.review.verdict === scenario.expected
			} catch (error) {
				result.error = String(error)
				result.correct = false
			}
			proof.reviews.push(result)
			await writeFile(join(path, 'evidence.json'), JSON.stringify(proof, null, 2), { mode: 0o600 })
			console.log(
				JSON.stringify({
					name: result.name,
					variant,
					correct: result.correct,
					durationMs: result.durationMs
				})
			)
		}
	proof.summary = Object.fromEntries(
		variants.map((variant) => {
			const rows = proof.reviews.filter((r: any) => r.variant === variant)
			return [
				variant,
				{
					total: rows.length,
					correct: rows.filter((r: any) => r.correct).length,
					invalid: rows.filter((r: any) => r.error).length,
					totalMs: rows.reduce((n: number, r: any) => n + r.durationMs, 0)
				}
			]
		})
	)
	proof.passed = variants.every((variant) => proof.summary[variant].correct === cases.length)
	assert(
		proof.passed,
		'Candidate review failed a required acceptance check; inspect evidence, do not weaken the oracle.'
	)
} finally {
	proof.finishedAt = new Date().toISOString()
	await writeFile(join(path, 'evidence.json'), JSON.stringify(proof, null, 2), { mode: 0o600 })
	console.log(JSON.stringify({ evidence: join(path, 'evidence.json'), summary: proof.summary }))
}
