/** Real Qwen + PostgreSQL + the production turn engine. No customer corpus or model substitutes. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimsUnexecutedAction } from '@avenos/chat-engine/action-claim'
import { type DurableChatInput, executeDurableChat } from '@avenos/chat-engine/durable'
import {
	JournaledChatPorts,
	journalDigest,
	type OperationProgress,
	type TurnJournal
} from '@avenos/chat-engine/journal'
import type { ModelStream } from '@avenos/chat-engine/model'
import { streamEvents } from '@avenos/chat-engine/stream'
import { IncompleteModelStream } from '@avenos/chat-engine/stream-errors'
import pg from 'pg'
import { portableRunClone } from '../../libs/aven-actors/src/run'
import { SqlChatJournal } from '../../services/actor-runner/src/chat-journal'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
const database = process.env.TEST_CHAT_JOURNAL_DATABASE_URL
assert(base && database, 'An isolated PostgreSQL URL and real Qwen endpoint are required.')
const available = await fetch(`${base.replace(/\/$/, '')}/models`, {
	signal: AbortSignal.timeout(10_000)
}).then((r) => {
	assert(r.ok)
	return r.json()
})
const upstream =
	process.env.LIVE_LLM_MODEL ?? available.data.find((m: { id: string }) => /qwen/i.test(m.id))?.id
assert(upstream && /qwen/i.test(upstream), 'This proof requires Qwen.')
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'proof-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: upstream,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const out = await mkdtemp(join(tmpdir(), 'aven-live-chat-journal-'))
const evidence: any = {
	synthetic: true,
	scope:
		'shared engine, production gateway, fenced PostgreSQL journal; not native or a production task Actor',
	startedAt: new Date().toISOString(),
	upstream,
	passed: false,
	cases: [],
	fingerprints: {}
}
for (const path of [
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/journal.ts',
	'libs/aven-chat-engine/src/durable.ts',
	'libs/aven-chat-engine/src/action-claim.ts',
	'libs/aven-chat-engine/src/research.ts',
	'services/actor-runner/src/chat-journal.ts',
	'deploy/e2e/live-chat-journal.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const engineDigest = await journalDigest(evidence.fingerprints)
const save = () =>
	writeFile(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2), {
		mode: 0o600
	})
const admin = new pg.Pool({ connectionString: database, max: 1 })
const name = `chat_proof_${randomUUID().replaceAll('-', '')}`
let pool: pg.Pool | undefined
let created = false
let modelRequests = 0
const model: ModelStream = async function* (messages, tools, signal, _model, options) {
	modelRequests++
	const response = await gateway.openAiChatCompletion(
		{
			model: 'proof-qwen',
			messages,
			stream: true,
			max_tokens: options?.max_tokens ?? 1024,
			temperature: 0.2,
			chat_template_kwargs: { enable_thinking: options?.thinking ?? false },
			...(options?.json && { response_format: { type: 'json_object' } }),
			...(tools.length && {
				tools: tools.map((tool) => ({ type: 'function', function: tool }))
			})
		},
		signal
	)
	assert(response.ok && response.body, `Model request failed: ${response.status}`)
	async function* chunks() {
		const decoder = new TextDecoder()
		for await (const bytes of response.body!) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
	yield* streamEvents(chunks(), signal)
}
const specs = [
	{
		name: 'save_note',
		description:
			'Save one requested note durably. Returns a saved receipt. Never claim a note is saved before this operation succeeds.',
		parameters: {
			type: 'object',
			properties: { text: { type: 'string' } },
			required: ['text'],
			additionalProperties: false
		}
	}
]
async function execute(name: string, args: string, invocationId: string) {
	assert.equal(name, 'save_note')
	const input = JSON.parse(args)
	assert(typeof input.text === 'string' && input.text.length > 0 && input.text.length < 4000)
	const receipt = JSON.stringify({
		ok: true,
		saved: true,
		noteId: invocationId,
		text: input.text
	})
	await pool!.query('INSERT INTO proof_notes(id,text,receipt) VALUES($1,$2,$3)', [
		invocationId,
		input.text,
		receipt
	])
	return { record: receipt, wire: receipt }
}
const resolve = async (invocationId: string) => {
	const result = await pool!.query('SELECT receipt FROM proof_notes WHERE id=$1', [invocationId])
	return result.rows[0]
		? {
				result: {
					record: result.rows[0].receipt,
					wire: result.rows[0].receipt
				},
				basis: 'receipt-check' as const
			}
		: null
}
async function runCase(text: string, fault: boolean) {
	const turnId = randomUUID(),
		ownerId = randomUUID()
	await pool!.query(
		`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
		VALUES($1::uuid,$2,$1::text,'proof','running',1,$3)`,
		[
			turnId,
			randomUUID(),
			{
				lease: {
					ownerId,
					expiresAt: new Date(Date.now() + 600_000).toISOString()
				}
			}
		]
	)
	const journal = new SqlChatJournal(pool!, turnId, ownerId, engineDigest)
	const input: DurableChatInput = {
		turnId,
		intentId: randomUUID(),
		user: { id: randomUUID(), role: 'user', content: text },
		history: [],
		context: 'Accepted Intent: fictional community workshop. The user asks for a saved note.',
		startedAt: await journal.startedAt(),
		timezone: 'Europe/London'
	}
	const before = Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count)
	const report: any = { text, fault, attempts: [] }
	evidence.cases.push(report)
	if (fault) {
		const interrupted: TurnJournal = {
			claim: (...args) => journal.claim(...args),
			timing: () => journal.timing(),
			complete: async (ordinal, value) => {
				if (value.kind === 'tool') {
					await assert.rejects(
						() =>
							journal.complete(ordinal, {
								...value,
								command: {
									...value.command,
									args: '{"text":"A different invented note"}'
								}
							}),
						/does not match its claimed command/
					)
					const row = await pool!.query(
						'SELECT state,value FROM run_steps WHERE run_id=$1 AND ordinal=$2',
						[turnId, ordinal]
					)
					assert.equal(row.rows[0].state, 'pending')
					assert.equal(row.rows[0].value, null)
					report.rejectedChangedCommand = true
					throw Error('Injected loss after the database write, before its journal acknowledgement.')
				}
				return journal.complete(ordinal, value)
			}
		}
		try {
			await executeDurableChat(input, {
				journal: interrupted,
				model,
				specs,
				execute
			})
			assert.fail('An uncheckpointed write must not produce a final success')
		} catch (error) {
			assert.match(String(error), /Injected loss/)
			report.attempts.push({ phase: 'lost-ack', error: String(error) })
		}
		assert.equal(
			Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count),
			before + 1
		)
		try {
			await executeDurableChat(input, { journal, model, specs, execute })
			assert.fail('An uncertain effect must not be replayed')
		} catch (error) {
			assert.match(String(error), /receipt checked/)
			report.attempts.push({ phase: 'unresolved', error: String(error) })
		}
	}
	const completed = await executeDurableChat(input, {
		journal,
		model,
		specs,
		execute,
		resolve
	})
	assert.equal(completed.state, 'completed', completed.failure ?? '')
	assert(
		completed.reply.calls?.some((call) => call.name === 'save_note' && call.status === 'completed')
	)
	assert(!completed.reply.content.includes('couldn’t complete'))
	report.attempts.push({ phase: 'completed', ...completed })
	assert.equal(
		Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count),
		before + 1
	)
	const checkpoints = await pool!.query(
		"SELECT ordinal,material_digest,value FROM run_steps WHERE run_id=$1 AND kind='tool' ORDER BY ordinal",
		[turnId]
	)
	assert.equal(checkpoints.rows.length, 1)
	for (const checkpoint of checkpoints.rows) {
		const call = completed.reply.calls!.find((call) => call.name === 'save_note')!
		assert.deepEqual(checkpoint.value.command, {
			name: call.name,
			args: call.arguments
		})
		assert.equal(await journalDigest(checkpoint.value.command), checkpoint.material_digest)
		assert.equal(checkpoint.value.result.record, call.result)
		await assert.rejects(
			() =>
				journal.complete(checkpoint.ordinal, {
					...checkpoint.value,
					command: {
						...checkpoint.value.command,
						name: 'not_the_original_operation'
					}
				}),
			/does not match its claimed command/
		)
	}
	report.toolReceipts = checkpoints.rows
	const modelCheckpoints = (
		await pool!.query(
			"SELECT ordinal,value FROM run_steps WHERE run_id=$1 AND kind='model' ORDER BY ordinal",
			[turnId]
		)
	).rows
	report.modelCheckpoints = modelCheckpoints
	await save()
	assert.equal(
		completed.reply.startedAt,
		Date.parse(input.startedAt),
		'The saved turn must retain its original journal start, not the latest attempt start.'
	)
	assert(
		completed.reply.durationMs! >=
			modelCheckpoints.reduce((sum, checkpoint) => sum + checkpoint.value.timing.durationMs, 0),
		'Total elapsed time must include previously checkpointed model work after recovery.'
	)
	assert.equal(completed.reply.modelRequestCount, modelCheckpoints.length)
	assert.equal(completed.reply.modelRequests?.length, modelCheckpoints.length)
	for (const [index, checkpoint] of modelCheckpoints.entries()) {
		const metric = completed.reply.modelRequests![index]!
		assert.equal(
			metric.durationMs,
			checkpoint.value.timing.durationMs,
			'A saved model metric must retain execution time, not checkpoint/replay overhead.'
		)
		assert.equal(metric.firstTextMs, checkpoint.value.timing.firstTextMs)
		assert.equal(metric.replayed, fault && index === 0 ? true : undefined)
	}
	const calls = modelRequests
	const replayed = await executeDurableChat(input, {
		journal,
		model,
		specs,
		execute,
		resolve
	})
	assert.deepEqual(
		replayed,
		completed,
		'A completed answer and its original timings must survive replay byte-for-byte.'
	)
	assert(completed.reply.calls?.every((call) => call.durationMs! > 0))
	assert.equal(
		completed.reply.calls?.find((call) => call.name === 'save_note')?.durationBasis,
		fault ? 'receipt-check' : undefined
	)
	assert.equal(
		modelRequests,
		calls,
		'Recovery of completed I/O must not generate another model answer'
	)
	assert.equal(
		Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count),
		before + 1
	)
	await assert.rejects(
		() =>
			executeDurableChat(
				{ ...input, context: 'Changed authority/context must not replay.' },
				{ journal, model, specs, execute }
			),
		/no longer matches/
	)
	await assert.rejects(
		() => new SqlChatJournal(pool!, turnId, ownerId, 'b'.repeat(64)).startedAt(),
		/original engine/
	)
	await pool!.query(
		`UPDATE runs SET record=jsonb_set(record,'{lease,ownerId}',to_jsonb($2::text)) WHERE id=$1`,
		[turnId, randomUUID()]
	)
	await assert.rejects(() => journal.claim(0, 'model', 'c'.repeat(64)), /ownership ended/)
	report.passed = true
	await save()
}
async function failedTurnCase() {
	const turnId = randomUUID(),
		ownerId = randomUUID()
	await pool!.query(
		`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
		VALUES($1::uuid,$2,$1::text,'proof','running',1,$3)`,
		[
			turnId,
			randomUUID(),
			{
				lease: {
					ownerId,
					expiresAt: new Date(Date.now() + 600_000).toISOString()
				}
			}
		]
	)
	const journal = new SqlChatJournal(pool!, turnId, ownerId, engineDigest)
	const input: DurableChatInput = {
		turnId,
		intentId: randomUUID(),
		user: {
			id: randomUUID(),
			role: 'user',
			content: 'Save a note to sort the donated clay stamps.'
		},
		history: [],
		context: 'Synthetic pottery workshop.',
		startedAt: await journal.startedAt(),
		timezone: 'Europe/London'
	}
	let cuts = 0
	const interrupted: ModelStream = async function* (...args) {
		for await (const event of model(...args)) {
			if (event.kind === 'text' || event.kind === 'tool') {
				cuts++
				throw new IncompleteModelStream('Injected disconnection during actual Qwen output.')
			}
			yield event
		}
	}
	const before = Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count)
	const result = await executeDurableChat(input, {
		journal,
		model: interrupted,
		specs,
		execute,
		resolve
	})
	assert.equal(result.state, 'failed')
	assert(result.failure)
	assert(cuts > 0)
	assert.equal(
		Number((await pool!.query('SELECT count(*) FROM proof_notes')).rows[0].count),
		before
	)
	const calls = modelRequests
	const replay = await executeDurableChat(input, {
		journal,
		model,
		specs,
		execute,
		resolve
	})
	assert.equal(replay.state, 'failed')
	assert.equal(replay.reply.content, result.reply.content)
	assert.equal(
		modelRequests,
		calls,
		'A recorded failed turn is not regenerated or relabeled successful.'
	)
	evidence.cases.push({
		name: 'Interrupted real stream retains a failed final outcome',
		cuts,
		result,
		passed: true
	})
	await save()
}
async function modelProgressCase() {
	const turnId = randomUUID(),
		ownerId = randomUUID()
	await pool!.query(
		`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
		VALUES($1::uuid,$2,$1::text,'proof','running',1,$3)`,
		[
			turnId,
			randomUUID(),
			{
				lease: {
					ownerId,
					expiresAt: new Date(Date.now() + 600_000).toISOString()
				}
			}
		]
	)
	const journal = new SqlChatJournal(pool!, turnId, ownerId, engineDigest)
	const progress: OperationProgress[] = []
	// The real runner enforces this boundary before storing progress. A missing
	// optional field must be omitted, not persisted as non-JSON undefined.
	const ports = new JournaledChatPorts(journal, undefined, async (value) => {
		progress.push(portableRunClone(value))
	})
	const stream = ports.model(model)
	assert.equal(
		await claimsUnexecutedAction(
			'Save a note to replenish the pottery brushes.',
			'I saved the note to your notebook.',
			undefined,
			stream
		),
		true
	)
	assert.equal(
		await claimsUnexecutedAction(
			'I would like to discuss a pottery course.',
			'What would you like to find out about it?',
			undefined,
			stream
		),
		false
	)
	assert(progress.every((value) => value.phase === 'verification'))
	// A transport-neutral stream caller need not classify its phase. Still use
	// Qwen here: do not fabricate a successful generation for the boundary proof.
	const events = []
	for await (const event of stream(
		[{ role: 'user', content: 'Reply with a brief greeting in English.' }],
		[]
	))
		events.push(event)
	assert(events.some((event) => event.kind === 'text' && event.text.trim()))
	assert.equal(progress.at(-1)?.state, 'completed')
	assert(!Object.hasOwn(progress.at(-1)!, 'phase'))
	ports.assertHealthy()
	evidence.cases.push({
		name: 'Action-claim audit and optional model phase cross the runner JSON boundary',
		progress,
		passed: true
	})
	await save()
}
try {
	await admin.query(`CREATE DATABASE ${name}`)
	created = true
	const url = new URL(database)
	url.pathname = `/${name}`
	pool = new pg.Pool({
		connectionString: url.toString(),
		options: '-c search_path=aven_actor_runs,public',
		max: 4
	})
	await pool.query('CREATE SCHEMA aven_actor_runs')
	for (const migration of ['0001_actor_runs', '0004_execution_journal'])
		await pool.query(
			await readFile(`services/platform-provisioner/components/actor-runs/${migration}.sql`, 'utf8')
		)
	await pool.query(
		'CREATE TABLE proof_notes(id uuid PRIMARY KEY, text text NOT NULL, receipt text NOT NULL)'
	)
	await modelProgressCase()
	await runCase('Save a note: Bring extra clay paddles for the beginners workshop.', false)
	await runCase(
		'Speichere bitte eine Notiz: Das neue Regal für die Töpferwerkstatt ausmessen.',
		true
	)
	await runCase('quick note pls save it: check the kiln shelf before the weekend class', true)
	await failedTurnCase()
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	evidence.modelRequests = modelRequests
	evidence.finishedAt = new Date().toISOString()
	await save()
	await pool?.end()
	if (created) await admin.query(`DROP DATABASE ${name}`)
	await admin.end()
	console.log(
		JSON.stringify({
			evidence: join(out, 'evidence.json'),
			passed: evidence.passed,
			modelRequests
		})
	)
}
