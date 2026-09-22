/** Read back actual native Qwen turns from the isolated customer's persistent history. */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { toolPreviews } from '@avenos/chat-engine/tool-preview'
import { callsFromPayload, responseDurationFromPayload } from '@avenos/chat-engine/turn-payload'

const evidencePath = process.argv[2]
assert(evidencePath, 'Pass a completed synthetic native workday evidence.json')
const evidence = await Bun.file(evidencePath).json()
assert.equal(evidence.synthetic, true)
assert(evidence.completedAt, 'The native journey must complete first')
const session = await Bun.file(resolve(dirname(evidencePath), '..', 'private-session.json')).json()
assert.equal(session.identity, 'http://localhost:13100')
const auth = await fetch(`${session.identity}/api/auth/token`, {
	headers: {
		cookie: session.browser.cookies
			.filter((c: any) => c.domain === 'localhost')
			.map((c: any) => `${c.name}=${c.value}`)
			.join('; ')
	}
})
assert(auth.ok)
const token = ((await auth.json()) as any).token
async function get(path: string): Promise<any> {
	const response = await fetch(`http://localhost:13000/api/${path}`, {
		headers: { authorization: `Bearer ${token}` }
	})
	assert(response.ok, `Persistent history HTTP ${response.status}`)
	return response.json()
}
const environment = (await get('environments')).environments.find(
	(e: any) => e.id === evidence.environmentId
)
assert(environment, 'The fictional account must own this environment')
assert.match(
	environment.purchasedName,
	new RegExp(`^workday-${session.accountId.slice(0, 8)}-[a-z0-9]+$`)
)
const base = `environments/${evidence.environmentId}/intents`
const intents: any[] = []
let cursor: string | null = null
do {
	const list = await get(`${base}/search${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
	intents.push(...list.intents)
	cursor = list.nextCursor
	assert(intents.length <= 100, 'This verifier expects a bounded fictional workday workspace')
} while (cursor)
const details = await Promise.all(intents.map((intent: any) => get(`${base}/${intent.id}`)))
assert(
	details.every((detail: any) => !detail.contributionsHasMore),
	'History exceeds this bounded workday verifier; do not silently inspect only its last page'
)
const contributions = details.flatMap((detail: any) => detail.contributions)
const replies = evidence.turns
	.flatMap((t: any) => t.turns)
	.filter((t: any) => t.role === 'assistant')
assert(replies.length > 0)
const checks = []
for (const reply of replies) {
	const saved = contributions.find((c: any) => c.id === reply.id)
	assert(saved, `Native response ${reply.id} must be persisted`)
	assert.equal(saved.text, reply.content)
	assert(reply.durationMs > 0)
	assert.equal(responseDurationFromPayload(saved.payload), reply.durationMs)
	const calls = callsFromPayload(saved.payload)
	assert.equal(calls.length, Math.min(reply.calls?.length ?? 0, 128))
	for (const call of calls) {
		const original = reply.calls.find((c: any) => c.id === call.id)
		assert.equal(call.status, original.status)
		assert(Number.isFinite(call.durationMs) && call.durationMs! >= 0)
		// JSON passes through Rust and PostgreSQL; their decimal rendering can
		// differ at the last binary-float bit. Preserve sub-ms precision, not
		// byte-identical floating-point serialization (tolerance: one nanosecond).
		assert(Number.isFinite(original.durationMs))
		assert(Math.abs(call.durationMs! - original.durationMs) < 0.000001)
	}
	checks.push({
		responseId: reply.id,
		durationMs: reply.durationMs,
		calls: calls.length,
		cards: toolPreviews(calls).length
	})
}
const path = resolve(dirname(evidencePath), 'persistent-chat-proof.json')
await Bun.write(
	path,
	JSON.stringify(
		{ synthetic: true, passed: true, environmentId: evidence.environmentId, checks },
		null,
		2
	)
)
console.log(
	`PASS persistent native responses, timings and tool states: ${checks.length} replies. ${path}`
)
