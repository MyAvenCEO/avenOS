/** Diagnose an actual synthetic failed journey, never customer history or a fake tool. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerReviewOptions, parseReview, ResearchRecord } from '@avenos/chat-engine/research'

const path = process.argv[2],
	base = process.env.LIVE_LLM_BASE_URL,
	model = process.env.LIVE_LLM_MODEL
assert(
	path && base && model && /qwen/i.test(model),
	'Supply synthetic dispatched-chat evidence and a real Qwen endpoint.'
)
const inputBytes = await readFile(path),
	source = JSON.parse(inputBytes.toString())
assert.equal(source.synthetic, true, 'Customer history must never be replayed as test evidence.')
const turn = source.turns.at(-1)
assert.equal(turn.state, 'failed')
const run = source.failedRuns.find((r: any) => r.record.parameters.turnId === turn.turnId)
assert(run)
const steps = source.failedSteps
	.filter((s: any) => s.run_id === run.id && s.kind === 'tool')
	.sort((a: any, b: any) => a.ordinal - b.ordinal)
assert.equal(steps.length, turn.payload.toolCalls.length)
const record = new ResearchRecord()
for (const [i, step] of steps.entries()) {
	const call = turn.payload.toolCalls[i]
	assert(
		step.value?.result?.record,
		'Replay full journal outcomes, never truncated history projections.'
	)
	record.observe(call.name, step.value.result.record, call.arguments)
}
const past = source.models.filter((m: any) => m.turnId === turn.turnId)
const text = (m: any) =>
	m.events
		.filter((e: any) => e.kind === 'text')
		.map((e: any) => e.text)
		.join('')
const previousRepair = past.findLast((m: any) => m.phase === 'repair')
const failedAudit = past.findLast((m: any) => m.phase === 'verification')
assert(previousRepair && failedAudit)
const directory = await mkdtemp(join(tmpdir(), 'aven-live-action-receipt-'))
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	sourceHash: createHash('sha256').update(inputBytes).digest('hex'),
	scope:
		'Live reviewer and answer-only repair over original synthetic journal receipts. No replayed action, native client or new task completion.',
	sourcePath: path,
	question: turn.input,
	startedAt: new Date().toISOString(),
	calls: [],
	fingerprints: {}
}
for (const file of [
	'libs/aven-chat-engine/src/research.ts',
	'deploy/e2e/live-action-receipt-review.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const save = () =>
	writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
async function complete(messages: any[], phase: string) {
	const started = performance.now()
	const response = await fetch(`${base!.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		signal: AbortSignal.timeout(180_000),
		body: JSON.stringify({
			model,
			messages,
			temperature: 0.2,
			max_tokens: answerReviewOptions(0).max_tokens,
			chat_template_kwargs: { enable_thinking: true }
		})
	})
	assert(response.ok, `Qwen HTTP ${response.status}`)
	const result = await response.json(),
		choice = result.choices?.[0]
	evidence.calls.push({
		phase,
		durationMs: performance.now() - started,
		finish: choice?.finish_reason,
		text: choice?.message?.content,
		usage: result.usage
	})
	await save()
	assert.equal(choice?.finish_reason, 'stop')
	return choice.message.content as string
}
try {
	const negative = parseReview(
		await complete(record.verifierMessages(turn.input, text(previousRepair)), 'negative-control'),
		0
	)
	assert.equal(negative.verdict, 'revise', 'A falsely completed correction must still be rejected.')
	// The old auditor demanded a new write from a tool-less repair. Preserve that
	// real failing instruction to prove it cannot become an invented receipt.
	const demanding = past.filter((m: any) => m.phase === 'verification').at(-2)
	const issues = parseReview(text(demanding), 0).issues
	evidence.requiredCorrections = issues
	const repaired = await complete(
		record.answerRepairMessages(turn.input, issues),
		'answer-only-repair'
	)
	const positive = parseReview(
		await complete(record.verifierMessages(turn.input, repaired), 'repaired-receipt-review'),
		0
	)
	assert.equal(positive.verdict, 'pass', JSON.stringify(positive))
	evidence.passed = true
} finally {
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(JSON.stringify({ directory, passed: evidence.passed }))
}
