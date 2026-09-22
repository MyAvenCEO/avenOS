/** Calibrate the independent oracle using real Qwen; never silently override a verdict. */
import assert from 'node:assert/strict'
import { ANSWER_AUDIT_INSTRUCTIONS } from './answer-audit'

const endpoint = process.env.LIVE_LLM_BASE_URL
assert(endpoint, 'LIVE_LLM_BASE_URL is required')
const evidence = await Bun.file(process.argv[2]!).json()
assert.equal(evidence.synthetic, true, 'Only independently invented workday evidence is allowed')
const observed = evidence.judgments.at(-1)
assert(observed?.criteria && observed.answer)
const cases = [
	{ name: 'qualified-missing-evidence', answer: observed.answer, expected: true },
	{
		name: 'invented-settlement',
		answer:
			observed.answer +
			' Correction: a credit note actually settled the remaining Cedar EUR 140; its open balance is now zero.',
		expected: false
	},
	{
		name: 'incorrect-open-total',
		answer:
			observed.answer +
			' Final total open across all three suppliers at June 30: EUR 140, not EUR 215.',
		expected: false
	}
]
const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
const proof = { synthetic: true, source: process.argv[2], model, reviews: [] as any[] }
const path = `/tmp/aven-live-answer-audit-${Date.now()}.json`
try {
	for (const scenario of cases) {
		const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				max_tokens: 2048,
				temperature: 0.2,
				chat_template_kwargs: { enable_thinking: false },
				response_format: { type: 'json_object' },
				messages: [
					{ role: 'system', content: ANSWER_AUDIT_INSTRUCTIONS },
					{
						role: 'user',
						content: JSON.stringify({ criteria: observed.criteria, answer: scenario.answer })
					}
				]
			}),
			signal: AbortSignal.timeout(180000)
		})
		assert(response.ok, `Qwen HTTP ${response.status}`)
		const completion = (await response.json()) as any
		assert.equal(completion.choices[0].finish_reason, 'stop')
		const verdict = JSON.parse(completion.choices[0].message.content)
		proof.reviews.push({ ...scenario, verdict, usage: completion.usage })
		assert.equal(verdict.pass, scenario.expected, verdict.reason)
		console.log(`PASS independent Qwen audit: ${scenario.name}`)
	}
} finally {
	await Bun.write(path, JSON.stringify(proof, null, 2))
	console.log(`Evidence: ${path}`)
}
