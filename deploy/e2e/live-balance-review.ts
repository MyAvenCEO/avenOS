/** Real-Qwen review of independently invented payable maturity mistakes. */
import assert from 'node:assert/strict'
import { answerReviewOptions, parseReview, ResearchRecord } from '@avenos/chat-engine/research'

const endpoint = process.env.LIVE_LLM_BASE_URL
assert(endpoint, 'LIVE_LLM_BASE_URL is required; no model substitute is supported')
const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
const content =
	'Fictional ledger snapshot at 2031-04-20. Willow invoice: EUR 80 invoiced, EUR 30 paid, EUR 50 outstanding; due 2031-04-20, no time-of-day deadline stated. Rowan invoice: EUR 40 invoiced, EUR 0 paid, EUR 40 outstanding; due 2031-05-10. These are all invoices in this synthetic ledger.'
const question =
	'At the 2031-04-20 snapshot, what is our total open balance, what is due today and what is not yet due? Is anything already overdue? Use only this ledger.'
const record = new ResearchRecord()
record.observe(
	'workspace_read',
	JSON.stringify({
		ok: true,
		recordType: 'document',
		sourceId: 'fictional-ledger',
		title: 'Synthetic maturity ledger',
		content,
		offset: 0,
		complete: true
	})
)
assert.equal(
	record.run('research_record', {
		items: [
			{
				requirement: 'Total open balance and maturity buckets at the snapshot',
				finding: '90 EUR open: 50 EUR due today and 40 EUR not yet due; no earlier deadline.',
				status: 'supported',
				sources: [{ sourceId: 'fictional-ledger', quote: content }]
			}
		]
	}).ok,
	true
)
const cases = [
	{
		name: 'due-subtotal-is-not-total-open',
		expected: 'revise',
		answer:
			'Open at the snapshot: EUR 50. Willow is overdue for EUR 50. Rowan has EUR 40 not yet due.'
	},
	{
		name: 'due-today-is-not-overdue',
		expected: 'revise',
		answer: 'Total open: EUR 90, comprising Willow EUR 50 overdue and Rowan EUR 40 not yet due.'
	},
	{
		name: 'correct-separated-buckets',
		expected: 'pass',
		answer:
			'Total open at 2031-04-20: EUR 90. Willow has EUR 50 due that day; Rowan has EUR 40 not yet due (due 2031-05-10). Nothing is already overdue on the supplied date-only evidence. Willow’s due date equals the snapshot date, with no earlier elapsed deadline stated.'
	}
]
const evidence = { synthetic: true, model, content, question, reviews: [] as any[] }
const path = `/tmp/aven-live-balance-review-${Date.now()}.json`
try {
	for (const scenario of cases) {
		const options = answerReviewOptions(record.items.length)
		const started = performance.now()
		const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: record.verifierMessages(question, scenario.answer),
				max_tokens: options.max_tokens,
				chat_template_kwargs: { enable_thinking: options.thinking },
				...(options.json && { response_format: { type: 'json_object' } })
			}),
			signal: AbortSignal.timeout(180000)
		})
		assert(response.ok, `Live Qwen HTTP ${response.status}`)
		const completion = (await response.json()) as any
		const raw = completion.choices?.[0]?.message?.content
		const review = parseReview(raw, 1)
		evidence.reviews.push({
			...scenario,
			raw,
			review,
			durationMs: performance.now() - started,
			usage: completion.usage,
			providerModel: completion.model
		})
		assert.equal(review.verdict, scenario.expected, JSON.stringify(review))
		console.log(`PASS real-Qwen maturity review: ${scenario.name}`)
	}
} finally {
	await Bun.write(path, JSON.stringify(evidence, null, 2))
	console.log(`Evidence: ${path}`)
}
