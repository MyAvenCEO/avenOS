/** Retry the actual fictional workday failure through the real authenticated runner. */
import assert from 'node:assert/strict'

const path = process.argv[2]
assert(path, 'Supply failed fictional workday evidence.json')
const evidence = await Bun.file(path).json()
assert.equal(evidence.synthetic, true)
assert.match(evidence.environmentId, /^[a-f0-9-]{36}$/)
const subjectId = evidence.built.subjectId
assert.match(subjectId, /^[a-f0-9-]{36}$/)
const archivedSession = Bun.file(`/tmp/aven-live-studio-workday/private-session-${subjectId}.json`)
const session = await ((await archivedSession.exists())
	? archivedSession
	: Bun.file('/tmp/aven-live-studio-workday/private-session.json')
).json()
assert.equal(session.accountId, subjectId)
assert.equal(session.identity, 'http://localhost:13100')
const authenticated = await fetch(`${session.identity}/api/auth/token`, {
	headers: {
		cookie: session.browser.cookies
			.filter((c: any) => c.domain === 'localhost')
			.map((c: any) => `${c.name}=${c.value}`)
			.join('; ')
	}
})
assert(authenticated.ok)
const { token } = (await authenticated.json()) as any
assert(token)
const base = `http://localhost:13000/api/environments/${evidence.environmentId}`
async function studio(operation: string, data: Record<string, unknown> = {}) {
	const write = ['run-control', 'start', 'connect'].includes(operation)
	const response = await fetch(`${base}/actor-runs/studio/${write ? 'command' : 'query'}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ operation, data })
	})
	assert(
		response.ok,
		`Studio ${operation}: ${response.status} ${response.ok ? '' : await response.text()}`
	)
	return response.json() as any
}
const before = await studio('state')
if (process.argv.includes('--connection')) {
	const command = evidence.turns
		.flatMap((turn: any) => turn.turns.flatMap((reply: any) => reply.calls ?? []))
		.findLast((call: any) => call.name === 'studio_connect' && call.status === 'completed')
	assert(command, 'Requires a successful connection command from the live Qwen journey')
	const data = JSON.parse(command.arguments)
	const connection = before.connections.find((item: any) => item.id === data.id)
	assert(connection)
	const started = performance.now()
	const [receipts, states] = await Promise.all([
		Promise.all(Array.from({ length: 8 }, () => studio('connect', data))),
		Promise.all(Array.from({ length: 4 }, () => studio('state')))
	])
	assert(states.every((state) => state.connections.length === before.connections.length))
	for (const receipt of receipts) {
		assert.equal(receipt.id, connection.id)
		assert.equal(receipt.artifactId, connection.artifact_id)
		assert.equal(receipt.enabled, connection.enabled, 'Replay must not undo a later pause')
	}
	const after = await studio('state')
	assert.equal(after.connections.length, before.connections.length)
	assert.deepEqual(
		after.connections.find((item: any) => item.id === data.id),
		connection
	)
	assert.equal(after.runs.length, before.runs.length, 'Connection retry must not execute the Skill')
	const result = {
		synthetic: true,
		environmentId: evidence.environmentId,
		elapsedMs: performance.now() - started,
		receipts,
		concurrentStateReads: states.length,
		connectionUnchanged: true,
		completedAt: new Date().toISOString()
	}
	await Bun.write(`${path}.connection-replay.json`, JSON.stringify(result, null, 2))
	console.log(`Concurrent real-connection replay passed: ${path}.connection-replay.json`)
	process.exit(0)
}
const previous = process.argv.includes('--verify')
	? await Bun.file(`${path}.report-recovery.json`).json()
	: null
const failed = previous
	? before.runs.find((run: any) => run.runId === previous.run.runId)
	: before.runs.find(
			(run: any) =>
				run.state === 'failed' && run.failure?.message.includes('Report verification failed')
		)
assert(failed, 'An actual quotation/coverage failure is required; never fabricate one')
const accepted = previous
	? previous.accepted
	: await studio('run-control', {
			runId: failed.runId,
			requestId: crypto.randomUUID(),
			action: 'retry'
		})
let run: any
for (let i = 0; i < 12; i++) {
	run = await studio('run-status', { runId: failed.runId, waitMs: 30000 })
	if (!['accepted', 'planning', 'running'].includes(run.state)) break
}
assert.equal(run.state, 'succeeded', JSON.stringify(run.failure))
const reportId = Object.values(run.outputs.outputs).flat()[0]
const report = await studio('inspect', { artifactId: reportId })
assert(
	report.production.run.receipt.model,
	'The recovered report must retain its real model receipt'
)
assert.equal(report.inputs.filter((input: any) => input.role === 'source').length, 2)
assert(report.evidence.length >= 2)
for (const edge of report.evidence) assert.equal(edge.inputLocator.kind, 'byte-range')
const body = await fetch(`${base}/artifacts/${reportId}/content`, {
	headers: { authorization: `Bearer ${token}` }
})
assert(body.ok)
const text = await body.text()
assert.match(text, /DE-2025-00001/)
assert.match(text, /statement|kontoauszug/i)
for (const edge of report.evidence) {
	const source = await fetch(`${base}/artifacts/${edge.inputArtifactId}/content`, {
		headers: { authorization: `Bearer ${token}` }
	})
	assert(source.ok)
	const bytes = Buffer.from(await source.arrayBuffer())
	const { start, endExclusive } = edge.inputLocator
	assert(start >= 0 && endExclusive > start && endExclusive <= bytes.length)
	const quote = bytes.subarray(start, endExclusive).toString('utf8')
	assert(
		text.includes(quote.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&')),
		'Each retained UTF-8 evidence range must reproduce an actual report quotation'
	)
}
const after = await studio('state')
assert.equal(after.runs.length, before.runs.length, 'Retry must reuse the failed activation')
const command = evidence.turns
	.flatMap((turn: any) => turn.turns.flatMap((reply: any) => reply.calls ?? []))
	.findLast((call: any) => call.name === 'studio_connect' && call.status === 'completed')
const receipt = await studio('connect', JSON.parse(command.arguments))
assert.equal(receipt.inputType.key, 'docs.extracted-text')
assert.equal(receipt.inputType.version, 2)
assert.equal(receipt.origin.procedureVersion, '*')
assert.equal((await studio('state')).connections.length, before.connections.length)
await Bun.write(
	`${path}.report-recovery.json`,
	JSON.stringify(
		{
			synthetic: true,
			accepted,
			run,
			report,
			text,
			receipt,
			completedAt: new Date().toISOString()
		},
		null,
		2
	)
)
console.log(
	'Real model report recovered under the same activation; two sources and exact evidence retained. Connection replay preserved identity and returned its exact trigger contract.'
)
